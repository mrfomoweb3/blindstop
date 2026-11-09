//! ECIES from the browser to the enclave:
//!
//! ```text
//! shared   = X25519(eph_sk, enclave_pk)            (all-zero shared secret refused)
//! key      = HKDF-SHA256(salt = eph_pk, ikm = shared, info = "blindstop:v1:seal") → 32 bytes
//! envelope = eph_pk (32) ‖ nonce (12) ‖ ChaCha20-Poly1305(key, nonce, padded_256, aad)
//! aad      = contract_id ‖ 0x00 ‖ owner_account_id ‖ 0x00 ‖ commitment (32)
//! ```

use crate::order::PADDED_LEN;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

pub const SEAL_INFO: &[u8] = b"blindstop:v1:seal";
pub const ENVELOPE_LEN: usize = 32 + 12 + PADDED_LEN + 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealError(pub &'static str);

impl std::fmt::Display for SealError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

pub fn aad(contract_id: &str, owner: &str, commitment: &[u8; 32]) -> Vec<u8> {
    let mut a = Vec::with_capacity(contract_id.len() + owner.len() + 34);
    a.extend_from_slice(contract_id.as_bytes());
    a.push(0);
    a.extend_from_slice(owner.as_bytes());
    a.push(0);
    a.extend_from_slice(commitment);
    a
}

fn derive_key(shared: &[u8; 32], eph_pub: &[u8; 32]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(eph_pub), shared);
    let mut okm = [0u8; 32];
    hk.expand(SEAL_INFO, &mut okm).expect("32 bytes is a valid HKDF-SHA256 length");
    okm
}

/// Seal with caller-provided randomness (the browser uses fresh randomness; tests pin it).
pub fn seal(
    enclave_pub: &[u8; 32],
    eph_secret: [u8; 32],
    nonce: [u8; 12],
    padded: &[u8; PADDED_LEN],
    aad: &[u8],
) -> Result<Vec<u8>, SealError> {
    let eph = StaticSecret::from(eph_secret);
    let eph_pub = PublicKey::from(&eph);
    let shared = eph.diffie_hellman(&PublicKey::from(*enclave_pub));
    if !shared.was_contributory() {
        return Err(SealError("low-order enclave key"));
    }
    let key = derive_key(shared.as_bytes(), eph_pub.as_bytes());
    let ct = ChaCha20Poly1305::new(Key::from_slice(&key))
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: padded, aad })
        .map_err(|_| SealError("encryption failed"))?;
    let mut out = Vec::with_capacity(ENVELOPE_LEN);
    out.extend_from_slice(eph_pub.as_bytes());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    debug_assert_eq!(out.len(), ENVELOPE_LEN);
    Ok(out)
}

pub fn open(enclave_secret: &StaticSecret, envelope: &[u8], aad: &[u8]) -> Result<[u8; PADDED_LEN], SealError> {
    if envelope.len() != ENVELOPE_LEN {
        return Err(SealError("envelope has the wrong length"));
    }
    let mut eph_pub = [0u8; 32];
    eph_pub.copy_from_slice(&envelope[..32]);
    let nonce = &envelope[32..44];
    let shared = enclave_secret.diffie_hellman(&PublicKey::from(eph_pub));
    if !shared.was_contributory() {
        return Err(SealError("low-order ephemeral key"));
    }
    let key = derive_key(shared.as_bytes(), &eph_pub);
    let pt = ChaCha20Poly1305::new(Key::from_slice(&key))
        .decrypt(Nonce::from_slice(nonce), Payload { msg: &envelope[44..], aad })
        .map_err(|_| SealError("decryption failed"))?;
    pt.try_into().map_err(|_| SealError("plaintext has the wrong length"))
}

/// The enclave's x25519 secret from 32 bytes of key material (OutLayer `mac("seal", …)`).
pub fn secret_from_seed(seed: [u8; 32]) -> StaticSecret {
    StaticSecret::from(seed)
}

pub fn public_of(secret: &StaticSecret) -> [u8; 32] {
    *PublicKey::from(secret).as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (StaticSecret, [u8; 32], [u8; PADDED_LEN]) {
        let sk = secret_from_seed([7u8; 32]);
        let pk = public_of(&sk);
        let mut padded = [0u8; PADDED_LEN];
        padded[..5].copy_from_slice(&[3, 0, 1, 2, 3]);
        (sk, pk, padded)
    }

    #[test]
    fn round_trip() {
        let (sk, pk, padded) = fixture();
        let a = aad("blindstop.testnet", "alice.testnet", &[9u8; 32]);
        let env = seal(&pk, [5u8; 32], [1u8; 12], &padded, &a).unwrap();
        assert_eq!(env.len(), ENVELOPE_LEN);
        assert_eq!(open(&sk, &env, &a).unwrap(), padded);
    }

    #[test]
    fn wrong_aad_fails() {
        let (sk, pk, padded) = fixture();
        let a = aad("blindstop.testnet", "alice.testnet", &[9u8; 32]);
        let env = seal(&pk, [5u8; 32], [1u8; 12], &padded, &a).unwrap();
        for other in [
            aad("blindstop.testnet", "mallory.testnet", &[9u8; 32]),
            aad("other.testnet", "alice.testnet", &[9u8; 32]),
            aad("blindstop.testnet", "alice.testnet", &[8u8; 32]),
        ] {
            assert_eq!(open(&sk, &env, &other), Err(SealError("decryption failed")));
        }
    }

    #[test]
    fn tamper_and_wrong_key_fail() {
        let (sk, pk, padded) = fixture();
        let a = aad("c", "o", &[0u8; 32]);
        let mut env = seal(&pk, [5u8; 32], [1u8; 12], &padded, &a).unwrap();
        env[100] ^= 1;
        assert!(open(&sk, &env, &a).is_err());
        let env = seal(&pk, [5u8; 32], [1u8; 12], &padded, &a).unwrap();
        assert!(open(&secret_from_seed([8u8; 32]), &env, &a).is_err());
        assert!(open(&sk, &env[..env.len() - 1], &a).is_err());
    }

    #[test]
    fn low_order_point_refused() {
        let (_, _, padded) = fixture();
        assert_eq!(seal(&[0u8; 32], [5u8; 32], [1u8; 12], &padded, b""), Err(SealError("low-order enclave key")));
    }
}
