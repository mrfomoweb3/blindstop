//! A deterministic stand-in for OutLayer's keystore: the same host-function semantics
//! (ed25519 / secp256k1 signing keys by path, symmetric encryption keys by path with the
//! `0x01 ‖ nonce(24) ‖ ct ‖ tag` XChaCha20-Poly1305 format, HMAC-SHA256 `mac`), derived from
//! a fixed master so every run of the harness sees the same keys.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct Keystore {
    master: [u8; 32],
    nonce_counter: u64,
}

fn hmac(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut m = <HmacSha256 as Mac>::new_from_slice(key).expect("hmac accepts any key");
    m.update(data);
    m.finalize().into_bytes().into()
}

impl Keystore {
    pub fn new(master: [u8; 32]) -> Self {
        Keystore { master, nonce_counter: 0 }
    }

    pub fn ed25519(&self, path: &str) -> ed25519_dalek::SigningKey {
        ed25519_dalek::SigningKey::from_bytes(&hmac(&self.master, format!("signing-key:v1:ed25519:{path}").as_bytes()))
    }

    pub fn secp256k1(&self, path: &str) -> k256::ecdsa::SigningKey {
        k256::ecdsa::SigningKey::from_slice(&hmac(&self.master, format!("signing-key:v1:secp256k1:{path}").as_bytes()))
            .expect("hmac output is a valid scalar with overwhelming probability")
    }

    fn enc_key(&self, path: &str) -> [u8; 32] {
        hmac(&self.master, format!("encryption-key:v1:{path}").as_bytes())
    }

    pub fn mac(&self, path: &str, data: &[u8]) -> Vec<u8> {
        let sub = hmac(&self.enc_key(path), b"mac");
        hmac(&sub, data).to_vec()
    }

    pub fn encrypt(&mut self, path: &str, plaintext: &[u8], aad: &[u8]) -> Vec<u8> {
        self.nonce_counter += 1;
        let mut nonce = [0u8; 24];
        nonce[..8].copy_from_slice(&self.nonce_counter.to_be_bytes());
        let ct = XChaCha20Poly1305::new_from_slice(&self.enc_key(path))
            .unwrap()
            .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad })
            .expect("encrypt");
        let mut out = vec![0x01];
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        out
    }

    pub fn decrypt(&self, path: &str, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() < 41 || ciphertext[0] != 0x01 {
            return Err("decryption failed".into());
        }
        XChaCha20Poly1305::new_from_slice(&self.enc_key(path))
            .unwrap()
            .decrypt(XNonce::from_slice(&ciphertext[1..25]), Payload { msg: &ciphertext[25..], aad })
            .map_err(|_| "decryption failed".into())
    }

    pub fn ed25519_public(&self, path: &str) -> Vec<u8> {
        self.ed25519(path).verifying_key().to_bytes().to_vec()
    }

    pub fn secp_public64(&self, path: &str) -> Vec<u8> {
        self.secp256k1(path).verifying_key().to_encoded_point(false).as_bytes()[1..].to_vec()
    }

    /// OutLayer's `sign`: ed25519 over raw bytes; secp256k1 over a 32-byte prehash → r‖s‖recid.
    pub fn sign(&self, path: &str, message: &[u8]) -> Result<Vec<u8>, String> {
        match path {
            "report" => {
                use ed25519_dalek::Signer;
                Ok(self.ed25519(path).sign(message).to_bytes().to_vec())
            }
            "hl-agent" => {
                let prehash: [u8; 32] = message.try_into().map_err(|_| "secp256k1 signs exactly 32 bytes".to_string())?;
                let (sig, recid) = self.secp256k1(path).sign_prehash_recoverable(&prehash).map_err(|e| e.to_string())?;
                let mut out = sig.to_bytes().to_vec();
                out.push(recid.to_byte());
                Ok(out)
            }
            other => Err(format!("undeclared signing key {other:?}")),
        }
    }

    pub fn public_key(&self, path: &str) -> Result<Vec<u8>, String> {
        match path {
            "report" => Ok(self.ed25519_public(path)),
            "hl-agent" => Ok(self.secp_public64(path)),
            other => Err(format!("undeclared signing key {other:?}")),
        }
    }
}
