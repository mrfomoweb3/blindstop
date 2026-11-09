//! Reports the enclave signs and the NEAR contract verifies with `env::ed25519_verify`.
//!
//! ```text
//! signed bytes = "blindstop:v1:report" ‖ kind_byte ‖ borsh(report)
//! ```

use borsh::{BorshDeserialize, BorshSerialize};

pub const REPORT_DOMAIN: &[u8] = b"blindstop:v1:report";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ReportKind {
    Fire = 0,
    Heartbeat = 1,
}

/// `FireReportV1.outcome`
pub const OUTCOME_FILLED: u8 = 0;
/// No open position on that coin and side (already closed, or the sibling SL/TP fired).
pub const OUTCOME_NO_POSITION: u8 = 1;
/// Hyperliquid refused or did not fill the close, every attempt.
pub const OUTCOME_REJECTED: u8 = 2;
/// The ciphertext does not open, its commitment does not match, or the wallet signature is
/// wrong. Retiring it stops a junk order from costing work on every tick.
pub const OUTCOME_INVALID: u8 = 3;

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct FireReportV1 {
    pub contract_id: String,
    pub order_id: u64,
    pub commitment: [u8; 32],
    pub hl_cloid: [u8; 16],
    pub hl_oid: u64,
    pub avg_px: String,
    pub filled_sz: String,
    pub outcome: u8,
    pub ts_ms: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct HeartbeatV1 {
    pub contract_id: String,
    pub tick_ms: u64,
    pub orders_seen: u32,
    /// The enclave cannot hash its own binary; this stays zero and the OutLayer attestation
    /// for the call (`/attestations/by-call/{id}`) names the exact wasm sha256 instead.
    pub code_hash: [u8; 32],
}

pub fn signed_bytes(kind: ReportKind, report_borsh: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(REPORT_DOMAIN.len() + 1 + report_borsh.len());
    v.extend_from_slice(REPORT_DOMAIN);
    v.push(kind as u8);
    v.extend_from_slice(report_borsh);
    v
}

pub fn cloid_for(order_id: u64, attempt: u32) -> [u8; 16] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"blindstop:cloid");
    h.update(order_id.to_be_bytes());
    h.update(attempt.to_be_bytes());
    let d = h.finalize();
    let mut c = [0u8; 16];
    c.copy_from_slice(&d[..16]);
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_bytes_layout() {
        let r = HeartbeatV1 { contract_id: "c".into(), tick_ms: 1, orders_seen: 2, code_hash: [0; 32] };
        let b = borsh::to_vec(&r).unwrap();
        let s = signed_bytes(ReportKind::Heartbeat, &b);
        assert!(s.starts_with(REPORT_DOMAIN));
        assert_eq!(s[REPORT_DOMAIN.len()], 1);
        assert_eq!(&s[REPORT_DOMAIN.len() + 1..], &b[..]);
    }

    #[test]
    fn cloids_differ_per_attempt_and_order() {
        assert_ne!(cloid_for(1, 1), cloid_for(1, 2));
        assert_ne!(cloid_for(1, 1), cloid_for(2, 1));
        assert_eq!(cloid_for(7, 3), cloid_for(7, 3));
    }
}
