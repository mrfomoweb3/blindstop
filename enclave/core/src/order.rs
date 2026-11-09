//! The sealed order (plaintext v1), its commitment, and its fixed-size padding.
//! Byte-for-byte identical to `packages/shared/src/order.ts`; `packages/shared/test/vectors.json`
//! pins both.

use crate::decimal::Dec;
use borsh::{BorshDeserialize, BorshSerialize};
use sha2::{Digest, Sha256};

pub const ORDER_VERSION: u8 = 1;
/// Every plaintext is padded to this length before sealing, so ciphertext length says nothing.
pub const PADDED_LEN: usize = 256;
pub const COMMITMENT_DOMAIN: &[u8] = b"blindstop:v1:order";

pub const NETWORK_MAINNET: u8 = 0;
pub const NETWORK_TESTNET: u8 = 1;
pub const SIDE_LONG: u8 = 0;
pub const SIDE_SHORT: u8 = 1;
pub const KIND_STOP_LOSS: u8 = 0;
pub const KIND_TAKE_PROFIT: u8 = 1;

pub const MAX_COIN_LEN: usize = 16;
pub const MAX_DECIMAL_LEN: usize = 24;
pub const MAX_SLIPPAGE_BPS: u16 = 1000;
pub const MAX_CONFIRM_TICKS: u8 = 10;
pub const SIZE_ALL: &str = "ALL";

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct SealedOrderV1 {
    pub version: u8,
    /// 0 = mainnet, 1 = testnet
    pub hl_network: u8,
    /// The trading wallet the agent acts for.
    pub hl_address: [u8; 20],
    /// Perp name as in Hyperliquid meta (main perp dex only), e.g. "BTC".
    pub coin: String,
    /// 0 = long, 1 = short: the position this order protects.
    pub position_side: u8,
    /// 0 = stop-loss, 1 = take-profit.
    pub kind: u8,
    pub trigger_px: String,
    /// Decimal string, or "ALL" for the full position.
    pub size: String,
    pub slippage_bps: u16,
    pub confirm_ticks: u8,
    pub created_ms: u64,
    pub salt: [u8; 32],
    /// EIP-191 signature by `hl_address` over [`wallet_binding_message`]. Without it anyone
    /// could seal an order naming someone else's wallet; the enclave refuses orders whose
    /// signature does not recover to `hl_address`.
    pub wallet_sig: [u8; 65],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderError(pub String);

impl std::fmt::Display for OrderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn err<T>(msg: impl Into<String>) -> Result<T, OrderError> {
    Err(OrderError(msg.into()))
}

/// What the order's numbers mean once checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CheckedOrder {
    pub is_mainnet: bool,
    pub is_long: bool,
    pub is_stop_loss: bool,
    pub trigger: Dec,
    /// `None` means close the whole position.
    pub size: Option<Dec>,
}

impl SealedOrderV1 {
    pub fn to_bytes(&self) -> Vec<u8> {
        borsh::to_vec(self).expect("borsh serialization of an in-memory struct")
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, OrderError> {
        SealedOrderV1::try_from_slice(bytes).map_err(|e| OrderError(format!("order does not decode: {e}")))
    }

    pub fn commitment(&self) -> [u8; 32] {
        commitment_of(&self.to_bytes())
    }

    /// Every rule the browser enforces, enforced again here.
    pub fn check(&self) -> Result<CheckedOrder, OrderError> {
        if self.version != ORDER_VERSION {
            return err(format!("unsupported order version {}", self.version));
        }
        if self.hl_network > NETWORK_TESTNET {
            return err("unknown network");
        }
        if self.position_side > SIDE_SHORT {
            return err("unknown position side");
        }
        if self.kind > KIND_TAKE_PROFIT {
            return err("unknown order kind");
        }
        if self.coin.is_empty() || self.coin.len() > MAX_COIN_LEN {
            return err("coin name length");
        }
        // Main perp dex names only: letters and digits (e.g. BTC, kPEPE, 1000BONK).
        if !self.coin.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return err("coin name must be alphanumeric (main perp dex only)");
        }
        if self.trigger_px.len() > MAX_DECIMAL_LEN || self.size.len() > MAX_DECIMAL_LEN {
            return err("number too long");
        }
        let trigger = Dec::parse(&self.trigger_px).map_err(|e| OrderError(format!("trigger: {e}")))?;
        if trigger.is_zero() {
            return err("trigger must be positive");
        }
        let size = if self.size == SIZE_ALL {
            None
        } else {
            let s = Dec::parse(&self.size).map_err(|e| OrderError(format!("size: {e}")))?;
            if s.is_zero() {
                return err("size must be positive");
            }
            Some(s)
        };
        if self.slippage_bps == 0 || self.slippage_bps > MAX_SLIPPAGE_BPS {
            return err("slippage must be 1..=1000 bps");
        }
        if self.confirm_ticks == 0 || self.confirm_ticks > MAX_CONFIRM_TICKS {
            return err("confirm_ticks must be 1..=10");
        }
        Ok(CheckedOrder {
            is_mainnet: self.hl_network == NETWORK_MAINNET,
            is_long: self.position_side == SIDE_LONG,
            is_stop_loss: self.kind == KIND_STOP_LOSS,
            trigger,
            size,
        })
    }
}

pub fn commitment_of(order_borsh: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(COMMITMENT_DOMAIN);
    h.update(order_borsh);
    h.finalize().into()
}

/// `u16 LE length ‖ borsh ‖ zeros` → exactly 256 bytes.
pub fn pad(order_borsh: &[u8]) -> Result<[u8; PADDED_LEN], OrderError> {
    if order_borsh.len() > PADDED_LEN - 2 {
        return err(format!("order is {} bytes, more than {}", order_borsh.len(), PADDED_LEN - 2));
    }
    let mut out = [0u8; PADDED_LEN];
    out[..2].copy_from_slice(&(order_borsh.len() as u16).to_le_bytes());
    out[2..2 + order_borsh.len()].copy_from_slice(order_borsh);
    Ok(out)
}

pub fn unpad(padded: &[u8]) -> Result<&[u8], OrderError> {
    if padded.len() != PADDED_LEN {
        return err("padded plaintext has the wrong length");
    }
    let len = u16::from_le_bytes([padded[0], padded[1]]) as usize;
    if len > PADDED_LEN - 2 {
        return err("length prefix out of range");
    }
    if padded[2 + len..].iter().any(|&b| b != 0) {
        return err("non-zero padding");
    }
    Ok(&padded[2..2 + len])
}

/// The message the trading wallet signs (EIP-191 `personal_sign`) to let a NEAR account's
/// sealed orders act on it. Human-readable on purpose: a hardware or extension wallet shows it.
pub fn wallet_binding_message(contract_id: &str, owner: &str, is_mainnet: bool) -> String {
    format!(
        "Blindstop: allow sealed stops placed by NEAR account {owner} on contract {contract_id} to close positions of this Hyperliquid wallet on {}.\n\nThis signature cannot move funds.",
        if is_mainnet { "Mainnet" } else { "Testnet" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn sample() -> SealedOrderV1 {
        SealedOrderV1 {
            version: 1,
            hl_network: NETWORK_TESTNET,
            hl_address: [0x11; 20],
            coin: "BTC".into(),
            position_side: SIDE_LONG,
            kind: KIND_STOP_LOSS,
            trigger_px: "95000.5".into(),
            size: SIZE_ALL.into(),
            slippage_bps: 100,
            confirm_ticks: 1,
            created_ms: 1_762_700_000_000,
            salt: [0x22; 32],
            wallet_sig: [0x33; 65],
        }
    }

    #[test]
    fn borsh_round_trip_and_pad() {
        let o = sample();
        let b = o.to_bytes();
        assert_eq!(SealedOrderV1::from_bytes(&b).unwrap(), o);
        let p = pad(&b).unwrap();
        assert_eq!(unpad(&p).unwrap(), &b[..]);
    }

    #[test]
    fn worst_case_order_fits_padding() {
        let mut o = sample();
        o.coin = "A".repeat(MAX_COIN_LEN);
        o.trigger_px = "1".repeat(MAX_DECIMAL_LEN);
        o.size = "2".repeat(MAX_DECIMAL_LEN);
        assert!(pad(&o.to_bytes()).is_ok());
    }

    #[test]
    fn unpad_rejects_tampering() {
        let mut p = pad(&sample().to_bytes()).unwrap();
        p[255] = 1;
        assert!(unpad(&p).is_err());
        let mut p = pad(&sample().to_bytes()).unwrap();
        p[0] = 0xff;
        p[1] = 0xff;
        assert!(unpad(&p).is_err());
    }

    #[test]
    fn checks() {
        assert!(sample().check().is_ok());
        let bad = |f: &dyn Fn(&mut SealedOrderV1)| {
            let mut o = sample();
            f(&mut o);
            o.check().is_err()
        };
        assert!(bad(&|o| o.version = 2));
        assert!(bad(&|o| o.hl_network = 2));
        assert!(bad(&|o| o.coin = "xyz:TSLA".into()));
        assert!(bad(&|o| o.coin = String::new()));
        assert!(bad(&|o| o.trigger_px = "0".into()));
        assert!(bad(&|o| o.trigger_px = "-5".into()));
        assert!(bad(&|o| o.size = "0".into()));
        assert!(bad(&|o| o.size = "all".into()));
        assert!(bad(&|o| o.slippage_bps = 0));
        assert!(bad(&|o| o.slippage_bps = 1001));
        assert!(bad(&|o| o.confirm_ticks = 0));
        assert!(bad(&|o| o.confirm_ticks = 11));
    }

    #[test]
    fn commitment_changes_with_salt() {
        let a = sample();
        let mut b = sample();
        b.salt[0] ^= 1;
        assert_ne!(a.commitment(), b.commitment());
    }
}
