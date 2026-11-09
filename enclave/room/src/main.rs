//! Blindstop inside OutLayer (Intel TDX): `blindstop_core::tick::Host` on real host functions.
//!
//! Keys (declared in the manifest, derived by OutLayer's keystore per project + operator):
//!   report   ed25519    signs fire reports and heartbeats (pinned in the NEAR contract)
//!   hl-agent secp256k1  the Hyperliquid agent; held by the host, never in this module's memory
//!   seal     symmetric  its MAC derives the x25519 key orders are sealed to
//!   state    symmetric  seals this module's own records (fire state, nonce)

use blindstop_core::tick::{self, Config, Host, KvRecord};
use outlayer::storage::{self, sealed};
use outlayer::{encryption_keys, env, signing_keys};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod config {
    include!(concat!(env!("OUT_DIR"), "/config.rs"));
}

/// Embedded in a custom section, so the wasm hash OutLayer attests covers it.
#[used]
#[link_section = "outlayer.manifest"]
static OUTLAYER_MANIFEST: [u8; include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json")).len()] =
    *include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json"));

const STATE: &str = "state";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

struct OutLayer;

impl Host for OutLayer {
    fn now_ms(&mut self) -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
    }

    fn http_post(&mut self, url: &str, body: &str) -> Result<String, String> {
        let resp = wasi_http_client::Client::new()
            .post(url)
            .header("content-type", "application/json")
            .connect_timeout(HTTP_TIMEOUT)
            .body(body.as_bytes())
            .send()
            .map_err(|e| format!("http: {e}"))?;
        let status = resp.status();
        let bytes = resp.body().map_err(|e| format!("http body: {e}"))?;
        if !(200..300).contains(&status) {
            return Err(format!("http {status}"));
        }
        String::from_utf8(bytes).map_err(|_| "http: body is not utf-8".into())
    }

    fn kv_get(&mut self, name: &str) -> Result<Option<KvRecord>, String> {
        Ok(sealed::get(STATE, None, name).map_err(|e| e.to_string())?.map(|s| {
            let token = s.stored_bytes().to_vec();
            KvRecord { value: s.into_plaintext(), token }
        }))
    }

    fn kv_insert(&mut self, name: &str, value: &[u8]) -> Result<bool, String> {
        sealed::set_if_absent(STATE, None, name, value).map_err(|e| e.to_string())
    }

    fn kv_replace(&mut self, name: &str, token: &[u8], value: &[u8]) -> Result<bool, String> {
        // sealed::set_if_equals by hand, so the compare is on the exact bytes `kv_get` saw:
        // key = mac(name), value = encrypt(value, aad = name).
        let key = sealed::storage_key(STATE, None, name).map_err(|e| e.to_string())?;
        let next = encryption_keys::encrypt(STATE, None, value, name.as_bytes()).map_err(|e| e.to_string())?;
        storage::set_if_equals_raw(&key, token, &next).map(|(ok, _)| ok).map_err(|e| e.to_string())
    }

    fn kv_delete(&mut self, name: &str) -> Result<(), String> {
        sealed::delete(STATE, None, name).map(|_| ()).map_err(|e| e.to_string())
    }

    fn seal_seed(&mut self) -> Result<[u8; 32], String> {
        let tag = encryption_keys::mac("seal", None, b"blindstop:v1:x25519").map_err(|e| e.to_string())?;
        tag.try_into().map_err(|_| "seal mac is not 32 bytes".into())
    }

    fn report_public_key(&mut self) -> Result<[u8; 32], String> {
        let pk = signing_keys::public_key("report", None).map_err(|e| e.to_string())?;
        pk.try_into().map_err(|_| "report key is not 32 bytes".into())
    }

    fn report_sign(&mut self, message: &[u8]) -> Result<[u8; 64], String> {
        let sig = signing_keys::sign("report", None, message).map_err(|e| e.to_string())?;
        sig.try_into().map_err(|_| "report signature is not 64 bytes".into())
    }

    fn agent_public_key(&mut self) -> Result<[u8; 64], String> {
        let pk = signing_keys::public_key("hl-agent", None).map_err(|e| e.to_string())?;
        pk.try_into().map_err(|_| "agent key is not 64 bytes".into())
    }

    fn agent_sign_prehash(&mut self, prehash: &[u8; 32]) -> Result<[u8; 65], String> {
        // The prehash is always an EIP-712 digest this module composed from an action it built.
        let sig = signing_keys::sign("hl-agent", None, prehash).map_err(|e| e.to_string())?;
        sig.try_into().map_err(|_| "agent signature is not 65 bytes".into())
    }
}

fn main() {
    let cfg = Config {
        contract_id: config::CONTRACT_ID.to_string(),
        near_rpcs: [config::NEAR_RPC_A.to_string(), config::NEAR_RPC_B.to_string()],
        max_orders_per_tick: 200,
        max_attempts: 5,
    };
    let input = env::input();
    let mut out = tick::run(&mut OutLayer, &cfg, &input);
    if let Some(obj) = out.as_object_mut() {
        obj.insert("network".into(), serde_json::Value::from(config::NETWORK));
    }
    env::output_string(&out.to_string());
}
