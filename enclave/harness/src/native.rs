//! `blindstop_core::tick::Host` implemented natively over the same fake keystore and world,
//! with sealed storage built exactly as OutLayer's SDK builds it (key = hex(mac(name)),
//! value = encrypt(value, aad = name)). Used by `cargo test`; the binary runs the wasm.

use crate::keystore::Keystore;
use crate::world::World;
use crate::Enclave;
use blindstop_core::tick::{self, Config, Host, KvRecord};
use serde_json::Value as Json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct NativeEnclave {
    pub keys: Keystore,
    pub raw: HashMap<String, Vec<u8>>,
    pub cfg: Config,
    pub clock_ms: Option<u64>,
}

struct Run<'a> {
    e: &'a mut NativeEnclave,
    world: &'a Arc<Mutex<World>>,
}

impl Run<'_> {
    fn key(&self, name: &str) -> String {
        hex::encode(self.e.keys.mac("state", name.as_bytes()))
    }
}

impl Host for Run<'_> {
    fn now_ms(&mut self) -> u64 {
        self.e.clock_ms.unwrap_or_else(|| {
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
        })
    }
    fn http_post(&mut self, url: &str, body: &str) -> Result<String, String> {
        let (status, text) = self.world.lock().unwrap().handle(url, body);
        if (200..300).contains(&status) {
            Ok(text)
        } else {
            Err(format!("http {status}"))
        }
    }
    fn kv_get(&mut self, name: &str) -> Result<Option<KvRecord>, String> {
        let k = self.key(name);
        match self.e.raw.get(&k) {
            None => Ok(None),
            Some(stored) => {
                let value = self.e.keys.decrypt("state", stored, name.as_bytes())?;
                Ok(Some(KvRecord { value, token: stored.clone() }))
            }
        }
    }
    fn kv_insert(&mut self, name: &str, value: &[u8]) -> Result<bool, String> {
        let k = self.key(name);
        if self.e.raw.contains_key(&k) {
            return Ok(false);
        }
        let v = self.e.keys.encrypt("state", value, name.as_bytes());
        self.e.raw.insert(k, v);
        Ok(true)
    }
    fn kv_replace(&mut self, name: &str, token: &[u8], value: &[u8]) -> Result<bool, String> {
        let k = self.key(name);
        if self.e.raw.get(&k).map(|v| v.as_slice()) != Some(token) {
            return Ok(false);
        }
        let v = self.e.keys.encrypt("state", value, name.as_bytes());
        self.e.raw.insert(k, v);
        Ok(true)
    }
    fn kv_delete(&mut self, name: &str) -> Result<(), String> {
        let k = self.key(name);
        self.e.raw.remove(&k);
        Ok(())
    }
    fn seal_seed(&mut self) -> Result<[u8; 32], String> {
        Ok(self.e.keys.mac("seal", b"blindstop:v1:x25519").try_into().unwrap())
    }
    fn report_public_key(&mut self) -> Result<[u8; 32], String> {
        Ok(self.e.keys.public_key("report")?.try_into().unwrap())
    }
    fn report_sign(&mut self, message: &[u8]) -> Result<[u8; 64], String> {
        Ok(self.e.keys.sign("report", message)?.try_into().unwrap())
    }
    fn agent_public_key(&mut self) -> Result<[u8; 64], String> {
        Ok(self.e.keys.public_key("hl-agent")?.try_into().unwrap())
    }
    fn agent_sign_prehash(&mut self, prehash: &[u8; 32]) -> Result<[u8; 65], String> {
        Ok(self.e.keys.sign("hl-agent", prehash)?.try_into().unwrap())
    }
}

impl NativeEnclave {
    pub fn new(keys: Keystore, contract_id: &str) -> Self {
        NativeEnclave {
            keys,
            raw: HashMap::new(),
            cfg: Config {
                contract_id: contract_id.into(),
                near_rpcs: [crate::world::RPC_A.into(), crate::world::RPC_B.into()],
                max_orders_per_tick: 200,
                max_attempts: 5,
            },
            clock_ms: None,
        }
    }
}

impl Enclave for NativeEnclave {
    fn call(&mut self, world: &Arc<Mutex<World>>, input: &str) -> Json {
        let cfg = self.cfg.clone();
        let mut run = Run { e: self, world };
        tick::run(&mut run, &cfg, input.as_bytes())
    }
    fn name(&self) -> &'static str {
        "native (blindstop-core, same host semantics)"
    }
}
