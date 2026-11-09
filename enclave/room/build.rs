//! Bakes the deployment into the wasm, so the attested hash covers it:
//!
//! * `config.rs`      — the contract this enclave serves and the two NEAR RPCs it reads.
//! * `manifest.json`  — OutLayer manifest (custom section `outlayer.manifest`): keys, the exact
//!                      network allowlist, and HTTPS-only callers.
//!
//!   BLINDSTOP_CONTRACT   required, e.g. blindstop.testnet
//!   BLINDSTOP_NETWORK    testnet (default) | mainnet  — picks default RPCs
//!   BLINDSTOP_NEAR_RPC_A / BLINDSTOP_NEAR_RPC_B   override the two independent providers
use std::{env, fs, path::PathBuf};

fn host_of(url: &str) -> String {
    let rest = url.strip_prefix("https://").unwrap_or_else(|| panic!("{url}: RPC must be https"));
    rest.split(['/', ':']).next().unwrap().to_ascii_lowercase()
}

fn main() {
    for v in ["BLINDSTOP_CONTRACT", "BLINDSTOP_NETWORK", "BLINDSTOP_NEAR_RPC_A", "BLINDSTOP_NEAR_RPC_B"] {
        println!("cargo:rerun-if-env-changed={v}");
    }
    let contract = env::var("BLINDSTOP_CONTRACT").expect("set BLINDSTOP_CONTRACT to the contract this enclave serves");
    assert!(
        !contract.is_empty() && contract.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-_.".contains(&b)),
        "BLINDSTOP_CONTRACT must be a NEAR account id"
    );
    let network = env::var("BLINDSTOP_NETWORK").unwrap_or_else(|_| "testnet".into());
    let (da, db) = match network.as_str() {
        "testnet" => ("https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"),
        "mainnet" => ("https://rpc.mainnet.fastnear.com", "https://near.drpc.org"),
        other => panic!("BLINDSTOP_NETWORK must be testnet or mainnet, not {other}"),
    };
    let rpc_a = env::var("BLINDSTOP_NEAR_RPC_A").unwrap_or_else(|_| da.into());
    let rpc_b = env::var("BLINDSTOP_NEAR_RPC_B").unwrap_or_else(|_| db.into());
    assert_ne!(host_of(&rpc_a), host_of(&rpc_b), "the two NEAR RPCs must be different providers");

    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(
        out.join("config.rs"),
        format!(
            "pub const CONTRACT_ID: &str = {contract:?};\npub const NEAR_RPC_A: &str = {rpc_a:?};\npub const NEAR_RPC_B: &str = {rpc_b:?};\npub const NETWORK: &str = {network:?};\n"
        ),
    )
    .unwrap();

    let hosts = [
        host_of(&rpc_a),
        host_of(&rpc_b),
        "api.hyperliquid.xyz".to_string(),
        "api.hyperliquid-testnet.xyz".to_string(),
    ];
    let manifest = serde_json_like(&hosts);
    fs::write(out.join("manifest.json"), manifest).unwrap();
}

/// Hand-written JSON (build scripts get no serde): stable bytes for a stable wasm hash.
fn serde_json_like(hosts: &[String]) -> String {
    let net = hosts.iter().map(|h| format!("{h:?}")).collect::<Vec<_>>().join(", ");
    format!(
        r#"{{
  "display": {{ "name": "Blindstop watcher" }},
  "capabilities": {{ "network": [{net}] }},
  "signing_keys": [
    {{ "path": "report", "type": "ed25519" }},
    {{ "path": "hl-agent", "type": "secp256k1" }}
  ],
  "encryption_keys": [
    {{ "path": "seal" }},
    {{ "path": "state" }}
  ],
  "callers": {{ "direct": "deny", "contract": "deny", "https": "allow" }}
}}
"#
    )
}
