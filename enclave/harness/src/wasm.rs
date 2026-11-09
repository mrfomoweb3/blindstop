//! Runs the real `blindstop-room.wasm` component under wasmtime, with OutLayer's host
//! interfaces (storage, signing keys, encryption keys) implemented in memory and every
//! outgoing HTTPS request routed to the fake [`World`] — after checking it against the
//! network allowlist in the wasm's own `outlayer.manifest` section.

use crate::keystore::Keystore;
use crate::world::World;
use crate::Enclave;
use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use serde_json::Value as Json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wasmtime::component::{Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::p2::pipe::{MemoryInputPipe, MemoryOutputPipe};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};
use wasmtime_wasi_http::bindings::http::types::ErrorCode;
use wasmtime_wasi_http::types::{HostFutureIncomingResponse, IncomingResponse, OutgoingRequestConfig};
use wasmtime_wasi_http::{HttpResult, WasiHttpCtx, WasiHttpView};

wasmtime::component::bindgen!({
    path: "wit",
    world: "blindstop:harness/host",
});

use near::storage::api as storage_api;
use outlayer::encryption_keys::api as enc_api;
use outlayer::signing_keys::api as sig_api;

/// What persists between runs (OutLayer's storage cell and keystore).
#[derive(Clone)]
pub struct Persistent {
    pub raw: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub keys: Arc<Mutex<Keystore>>,
}

struct State {
    wasi: WasiCtx,
    table: ResourceTable,
    http: WasiHttpCtx,
    world: Arc<Mutex<World>>,
    allowlist: Vec<String>,
    p: Persistent,
}

impl WasiView for State {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView { ctx: &mut self.wasi, table: &mut self.table }
    }
}

impl WasiHttpView for State {
    fn ctx(&mut self) -> &mut WasiHttpCtx {
        &mut self.http
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
    fn send_request(
        &mut self,
        request: hyper::Request<wasmtime_wasi_http::body::HyperOutgoingBody>,
        _config: OutgoingRequestConfig,
    ) -> HttpResult<HostFutureIncomingResponse> {
        let host = request.uri().host().unwrap_or_default().to_ascii_lowercase();
        if !self.allowlist.contains(&host) {
            // What OutLayer's worker does with a host the manifest does not list.
            return Ok(HostFutureIncomingResponse::ready(Ok(Err(ErrorCode::HttpRequestDenied))));
        }
        let mut url = request.uri().to_string();
        if request.uri().path() == "/" {
            url = url.trim_end_matches('/').to_string();
        }
        let world = self.world.clone();
        let handle = wasmtime_wasi::runtime::spawn(async move {
            let body = request.into_body().collect().await.map(|c| c.to_bytes()).unwrap_or_default();
            let (status, text) = world.lock().unwrap().handle(&url, &String::from_utf8_lossy(&body));
            let resp = hyper::Response::builder()
                .status(status)
                .body(Full::new(Bytes::from(text)).map_err(|never| match never {}).boxed())
                .expect("response");
            Ok(Ok(IncomingResponse { resp, worker: None, between_bytes_timeout: Duration::from_secs(10) }))
        });
        Ok(HostFutureIncomingResponse::pending(handle))
    }
}

impl storage_api::Host for State {
    fn set(&mut self, key: String, value: Vec<u8>) -> String {
        self.p.raw.lock().unwrap().insert(format!("enc:{key}"), value);
        String::new()
    }
    fn get(&mut self, key: String) -> (Vec<u8>, String) {
        (self.p.raw.lock().unwrap().get(&format!("enc:{key}")).cloned().unwrap_or_default(), String::new())
    }
    fn has(&mut self, key: String) -> (bool, String) {
        let m = self.p.raw.lock().unwrap();
        (m.contains_key(&key) || m.contains_key(&format!("enc:{key}")), String::new())
    }
    fn delete(&mut self, key: String) -> (bool, String) {
        let mut m = self.p.raw.lock().unwrap();
        let a = m.remove(&key).is_some();
        let b = m.remove(&format!("enc:{key}")).is_some();
        (a || b, String::new())
    }
    fn list_keys(&mut self, prefix: String) -> (String, String) {
        let m = self.p.raw.lock().unwrap();
        let keys: Vec<&String> = m.keys().filter(|k| k.starts_with(&prefix)).collect();
        (serde_json::to_string(&keys).unwrap(), String::new())
    }
    fn set_if_absent(&mut self, key: String, value: Vec<u8>) -> (bool, String) {
        self.set_if_absent_raw(format!("enc:{key}"), value)
    }
    fn set_if_equals(&mut self, key: String, expected: Vec<u8>, new_value: Vec<u8>) -> (bool, Vec<u8>, String) {
        self.set_if_equals_raw(format!("enc:{key}"), expected, new_value)
    }
    fn set_raw(&mut self, key: String, value: Vec<u8>) -> String {
        self.p.raw.lock().unwrap().insert(key, value);
        String::new()
    }
    fn get_raw(&mut self, key: String) -> (Vec<u8>, String) {
        (self.p.raw.lock().unwrap().get(&key).cloned().unwrap_or_default(), String::new())
    }
    fn set_if_absent_raw(&mut self, key: String, value: Vec<u8>) -> (bool, String) {
        let mut m = self.p.raw.lock().unwrap();
        if m.contains_key(&key) {
            return (false, String::new());
        }
        m.insert(key, value);
        (true, String::new())
    }
    fn set_if_equals_raw(&mut self, key: String, expected: Vec<u8>, new_value: Vec<u8>) -> (bool, Vec<u8>, String) {
        let mut m = self.p.raw.lock().unwrap();
        match m.get(&key) {
            Some(cur) if *cur == expected => {
                m.insert(key, new_value);
                (true, vec![], String::new())
            }
            Some(cur) => (false, cur.clone(), String::new()),
            None => (false, vec![], String::new()),
        }
    }
    fn increment(&mut self, _key: String, _delta: i64) -> (i64, String) {
        (0, "not used by blindstop".into())
    }
    fn decrement(&mut self, _key: String, _delta: i64) -> (i64, String) {
        (0, "not used by blindstop".into())
    }
    fn set_worker(&mut self, _key: String, _value: Vec<u8>, _is_encrypted: Option<bool>) -> String {
        "not used by blindstop".into()
    }
    fn get_worker(&mut self, _key: String, _project: Option<String>) -> (Vec<u8>, String) {
        (vec![], "not used by blindstop".into())
    }
    fn get_by_version(&mut self, _key: String, _wasm_hash: String) -> (Vec<u8>, String) {
        (vec![], "not used by blindstop".into())
    }
    fn clear_all(&mut self) -> String {
        "not used by blindstop".into()
    }
    fn clear_version(&mut self, _wasm_hash: String) -> String {
        "not used by blindstop".into()
    }
}

const DECLARED_SIGNING: [&str; 2] = ["report", "hl-agent"];
const DECLARED_ENCRYPTION: [&str; 2] = ["seal", "state"];

impl sig_api::Host for State {
    fn public_key(&mut self, path: String, vault: Option<String>) -> Result<Vec<u8>, String> {
        if vault.is_some() || !DECLARED_SIGNING.contains(&path.as_str()) {
            return Err(format!("undeclared signing key {path:?}"));
        }
        self.p.keys.lock().unwrap().public_key(&path)
    }
    fn sign(&mut self, path: String, vault: Option<String>, message: Vec<u8>) -> Result<Vec<u8>, String> {
        if vault.is_some() || !DECLARED_SIGNING.contains(&path.as_str()) {
            return Err(format!("undeclared signing key {path:?}"));
        }
        self.p.keys.lock().unwrap().sign(&path, &message)
    }
    fn sign_nep413(
        &mut self,
        _path: String,
        _vault: Option<String>,
        _message: String,
        _recipient: String,
        _nonce: Vec<u8>,
        _callback_url: Option<String>,
    ) -> Result<sig_api::Nep413Signature, String> {
        Err("not used by blindstop".into())
    }
}

impl enc_api::Host for State {
    fn encrypt(&mut self, path: String, vault: Option<String>, plaintext: Vec<u8>, aad: Vec<u8>) -> Result<Vec<u8>, String> {
        if vault.is_some() || !DECLARED_ENCRYPTION.contains(&path.as_str()) {
            return Err(format!("undeclared encryption key {path:?}"));
        }
        Ok(self.p.keys.lock().unwrap().encrypt(&path, &plaintext, &aad))
    }
    fn decrypt(&mut self, path: String, vault: Option<String>, ciphertext: Vec<u8>, aad: Vec<u8>) -> Result<Vec<u8>, String> {
        if vault.is_some() || !DECLARED_ENCRYPTION.contains(&path.as_str()) {
            return Err(format!("undeclared encryption key {path:?}"));
        }
        self.p.keys.lock().unwrap().decrypt(&path, &ciphertext, &aad)
    }
    fn mac(&mut self, path: String, vault: Option<String>, data: Vec<u8>) -> Result<Vec<u8>, String> {
        if vault.is_some() || !DECLARED_ENCRYPTION.contains(&path.as_str()) {
            return Err(format!("undeclared encryption key {path:?}"));
        }
        Ok(self.p.keys.lock().unwrap().mac(&path, &data))
    }
}

/// The JSON in the wasm's `outlayer.manifest` custom section.
pub fn extract_manifest(wasm: &[u8]) -> Result<Json> {
    let marker = b"outlayer.manifest";
    let at = wasm.windows(marker.len()).position(|w| w == marker).ok_or_else(|| anyhow!("no outlayer.manifest section"))?;
    let start = at + wasm[at..].iter().position(|&b| b == b'{').ok_or_else(|| anyhow!("manifest has no JSON"))?;
    let mut depth = 0i32;
    for (i, &b) in wasm[start..].iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_slice(&wasm[start..=start + i]).context("manifest is not JSON");
                }
            }
            _ => {}
        }
    }
    Err(anyhow!("manifest JSON is not terminated"))
}

pub struct WasmEnclave {
    engine: Engine,
    component: Component,
    linker: Linker<State>,
    allowlist: Vec<String>,
    pub manifest: Json,
    pub p: Persistent,
}

impl WasmEnclave {
    pub fn load(wasm_path: &str, keys: Keystore) -> Result<Self> {
        let bytes = std::fs::read(wasm_path).with_context(|| format!("read {wasm_path}"))?;
        let manifest = extract_manifest(&bytes)?;
        let allowlist = manifest["capabilities"]["network"]
            .as_array()
            .ok_or_else(|| anyhow!("manifest declares no network allowlist"))?
            .iter()
            .map(|h| h.as_str().map(str::to_ascii_lowercase).ok_or_else(|| anyhow!("bad host entry")))
            .collect::<Result<Vec<_>>>()?;
        let mut config = Config::new();
        config.wasm_component_model(true);
        let engine = Engine::new(&config)?;
        let component = Component::from_binary(&engine, &bytes)?;
        let mut linker: Linker<State> = Linker::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
        wasmtime_wasi_http::add_only_http_to_linker_sync(&mut linker)?;
        Host_::add_to_linker::<State, HasSelf<State>>(&mut linker, |s| s)?;
        Ok(WasmEnclave {
            engine,
            component,
            linker,
            allowlist,
            manifest,
            p: Persistent { raw: Arc::new(Mutex::new(HashMap::new())), keys: Arc::new(Mutex::new(keys)) },
        })
    }
}

impl Enclave for WasmEnclave {
    fn call(&mut self, world: &Arc<Mutex<World>>, input: &str) -> Json {
        let stdout = MemoryOutputPipe::new(1 << 20);
        let wasi = WasiCtxBuilder::new()
            .stdin(MemoryInputPipe::new(input.as_bytes().to_vec()))
            .stdout(stdout.clone())
            .inherit_stderr()
            .build();
        let state = State {
            wasi,
            table: ResourceTable::new(),
            http: WasiHttpCtx::new(),
            world: world.clone(),
            allowlist: self.allowlist.clone(),
            p: self.p.clone(),
        };
        let mut store = Store::new(&self.engine, state);
        let cmd = wasmtime_wasi::p2::bindings::sync::Command::instantiate(&mut store, &self.component, &self.linker)
            .expect("instantiate component");
        let exit = cmd.wasi_cli_run().call_run(&mut store).expect("run");
        assert!(exit.is_ok(), "component exited with an error");
        let out = stdout.contents();
        serde_json::from_slice(&out).unwrap_or_else(|e| panic!("component output is not JSON ({e}): {}", String::from_utf8_lossy(&out)))
    }

    fn name(&self) -> &'static str {
        "wasm (wasmtime, real OutLayer component)"
    }
}
