//! Hyperliquid L1 action signing, ported from the official Python SDK
//! (`hyperliquid-python-sdk` 0.24.0, `hyperliquid/utils/signing.py`):
//!
//! ```text
//! connectionId = keccak256( msgpack(action) ‖ nonce_u64_be ‖ 0x00 (no vault) [‖ 0x00 ‖ expires_u64_be] )
//! digest       = EIP-712( Agent { source: "a" mainnet | "b" testnet, connectionId } ,
//!                         domain { name "Exchange", version "1", chainId 1337, verifyingContract 0x0 } )
//! signature    = secp256k1 over digest → { r, s, v = 27 + recid }
//! ```
//!
//! `enclave/core/tests/hl_vectors.json` holds outputs of the Python SDK for fixed keys and
//! nonces; `tests/hl_vectors.rs` requires this module to reproduce them byte for byte.

use super::msgpack::Value;
use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use sha3::{Digest, Keccak256};

pub fn keccak(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

/// Anything that can sign a 32-byte prehash with the agent key: OutLayer's host-held
/// secp256k1 key inside the enclave, a local key in tests and the harness.
pub trait AgentSigner {
    /// 65 bytes `r ‖ s ‖ recid` with low `s` and recid 0 or 1.
    fn sign_prehash(&mut self, prehash: &[u8; 32]) -> Result<[u8; 65], String>;
}

pub struct LocalSigner(pub SigningKey);

impl LocalSigner {
    pub fn from_bytes(sk: &[u8; 32]) -> Result<Self, String> {
        SigningKey::from_slice(sk).map(LocalSigner).map_err(|e| e.to_string())
    }

    pub fn address(&self) -> [u8; 20] {
        let p = self.0.verifying_key().to_encoded_point(false);
        let mut xy = [0u8; 64];
        xy.copy_from_slice(&p.as_bytes()[1..]);
        address_from_pubkey64(&xy)
    }
}

impl AgentSigner for LocalSigner {
    fn sign_prehash(&mut self, prehash: &[u8; 32]) -> Result<[u8; 65], String> {
        let (sig, recid) = self.0.sign_prehash_recoverable(prehash).map_err(|e| e.to_string())?;
        // k256 already returns low-s; normalize defensively and flip recid if it changes.
        let (sig, recid) = match sig.normalize_s() {
            Some(n) => (n, RecoveryId::new(!recid.is_y_odd(), recid.is_x_reduced())),
            None => (sig, recid),
        };
        let mut out = [0u8; 65];
        out[..64].copy_from_slice(&sig.to_bytes());
        out[64] = recid.to_byte();
        Ok(out)
    }
}

/// EVM address of a 64-byte uncompressed public key (`x ‖ y`, no 0x04 prefix).
pub fn address_from_pubkey64(xy: &[u8; 64]) -> [u8; 20] {
    let h = keccak(xy);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    a
}

pub fn action_hash(action: &Value, nonce: u64, expires_after: Option<u64>) -> [u8; 32] {
    let mut data = action.encode();
    data.extend_from_slice(&nonce.to_be_bytes());
    data.push(0x00); // no vault address
    if let Some(e) = expires_after {
        data.push(0x00);
        data.extend_from_slice(&e.to_be_bytes());
    }
    keccak(&data)
}

fn domain_separator() -> [u8; 32] {
    let type_hash = keccak(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    let mut enc = Vec::with_capacity(32 * 5);
    enc.extend_from_slice(&type_hash);
    enc.extend_from_slice(&keccak(b"Exchange"));
    enc.extend_from_slice(&keccak(b"1"));
    let mut chain_id = [0u8; 32];
    chain_id[24..].copy_from_slice(&1337u64.to_be_bytes());
    enc.extend_from_slice(&chain_id);
    enc.extend_from_slice(&[0u8; 32]); // verifyingContract = 0x000…000
    keccak(&enc)
}

/// The EIP-712 digest of the phantom `Agent { source, connectionId }`.
pub fn agent_digest(connection_id: &[u8; 32], is_mainnet: bool) -> [u8; 32] {
    let type_hash = keccak(b"Agent(string source,bytes32 connectionId)");
    let source: &[u8] = if is_mainnet { b"a" } else { b"b" };
    let mut enc = Vec::with_capacity(96);
    enc.extend_from_slice(&type_hash);
    enc.extend_from_slice(&keccak(source));
    enc.extend_from_slice(connection_id);
    let struct_hash = keccak(&enc);
    let mut msg = Vec::with_capacity(66);
    msg.extend_from_slice(&[0x19, 0x01]);
    msg.extend_from_slice(&domain_separator());
    msg.extend_from_slice(&struct_hash);
    keccak(&msg)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HlSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    /// 27 or 28
    pub v: u8,
}

impl HlSignature {
    pub fn from_rsv(sig: &[u8; 65]) -> Result<HlSignature, String> {
        let mut r = [0u8; 32];
        let mut s = [0u8; 32];
        r.copy_from_slice(&sig[..32]);
        s.copy_from_slice(&sig[32..64]);
        let v = match sig[64] {
            0 | 1 => sig[64] + 27,
            27 | 28 => sig[64],
            other => return Err(format!("bad recovery id {other}")),
        };
        Ok(HlSignature { r, s, v })
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "r": format!("0x{}", hex::encode(self.r)),
            "s": format!("0x{}", hex::encode(self.s)),
            "v": self.v,
        })
    }

    pub fn to_rsv(&self) -> [u8; 65] {
        let mut out = [0u8; 65];
        out[..32].copy_from_slice(&self.r);
        out[32..64].copy_from_slice(&self.s);
        out[64] = self.v;
        out
    }
}

pub fn sign_l1_action(
    signer: &mut dyn AgentSigner,
    action: &Value,
    nonce: u64,
    expires_after: Option<u64>,
    is_mainnet: bool,
) -> Result<HlSignature, String> {
    let cid = action_hash(action, nonce, expires_after);
    let digest = agent_digest(&cid, is_mainnet);
    HlSignature::from_rsv(&signer.sign_prehash(&digest)?)
}

/// Address that produced `sig` (65 bytes, v as 0/1 or 27/28) over `prehash`.
pub fn recover_address(prehash: &[u8; 32], sig: &[u8; 65]) -> Result<[u8; 20], String> {
    let recid_byte = match sig[64] {
        0 | 1 => sig[64],
        27 | 28 => sig[64] - 27,
        other => return Err(format!("bad recovery id {other}")),
    };
    let recid = RecoveryId::from_byte(recid_byte).ok_or("bad recovery id")?;
    let signature = Signature::from_slice(&sig[..64]).map_err(|e| e.to_string())?;
    if signature.normalize_s().is_some() {
        return Err("high-s signature".into());
    }
    let vk = VerifyingKey::recover_from_prehash(prehash, &signature, recid).map_err(|e| e.to_string())?;
    let p = vk.to_encoded_point(false);
    let mut xy = [0u8; 64];
    xy.copy_from_slice(&p.as_bytes()[1..]);
    Ok(address_from_pubkey64(&xy))
}

pub fn recover_l1_signer(action: &Value, nonce: u64, sig: &HlSignature, is_mainnet: bool) -> Result<[u8; 20], String> {
    let digest = agent_digest(&action_hash(action, nonce, None), is_mainnet);
    recover_address(&digest, &sig.to_rsv())
}

/// EIP-191 `personal_sign` hash.
pub fn personal_message_hash(message: &[u8]) -> [u8; 32] {
    let mut data = format!("\x19Ethereum Signed Message:\n{}", message.len()).into_bytes();
    data.extend_from_slice(message);
    keccak(&data)
}

pub fn address_hex(a: &[u8; 20]) -> String {
    format!("0x{}", hex::encode(a))
}

pub fn parse_address(s: &str) -> Result<[u8; 20], String> {
    let h = s.strip_prefix("0x").ok_or("address must start with 0x")?;
    let b = hex::decode(h).map_err(|e| e.to_string())?;
    b.try_into().map_err(|_| "address must be 20 bytes".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_signer_round_trip() {
        let mut s = LocalSigner::from_bytes(&[1u8; 32]).unwrap();
        let action = Value::map(vec![("type", Value::str("order"))]);
        let sig = sign_l1_action(&mut s, &action, 1, None, false).unwrap();
        assert_eq!(recover_l1_signer(&action, 1, &sig, false).unwrap(), s.address());
        // Mainnet and testnet digests differ: a testnet signature does not recover on mainnet.
        assert_ne!(recover_l1_signer(&action, 1, &sig, true).unwrap(), s.address());
    }

    #[test]
    fn personal_sign_known_vector() {
        // keccak256("\x19Ethereum Signed Message:\n5hello")
        assert_eq!(
            hex::encode(personal_message_hash(b"hello")),
            "50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750"
        );
    }

    #[test]
    fn address_of_known_key() {
        // Private key 0x…01 → the well-known address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
        let mut k = [0u8; 32];
        k[31] = 1;
        let s = LocalSigner::from_bytes(&k).unwrap();
        assert_eq!(address_hex(&s.address()), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
    }
}
