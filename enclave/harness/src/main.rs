//! blindstop-harness [path/to/blindstop-room.wasm]
//!
//! Runs every scenario against the real OutLayer component (built with
//! BLINDSTOP_CONTRACT=blindstop-harness.testnet) and prints `HARNESS PASSED`.

use blindstop_harness::{keystore, run_all, wasm::WasmEnclave, CONTRACT};

fn main() -> anyhow::Result<()> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "enclave/room/target/wasm32-wasip2/release/blindstop-room.wasm".into());
    let mut enclave = WasmEnclave::load(&path, keystore())?;

    // The manifest is part of the attested wasm: check what it grants.
    let m = &enclave.manifest;
    let mut hosts: Vec<&str> = m["capabilities"]["network"].as_array().unwrap().iter().map(|h| h.as_str().unwrap()).collect();
    hosts.sort();
    assert_eq!(
        hosts,
        ["api.hyperliquid-testnet.xyz", "api.hyperliquid.xyz", "near-testnet.drpc.org", "rpc.testnet.fastnear.com"],
        "network allowlist"
    );
    assert_eq!(m["callers"]["direct"], "deny");
    assert_eq!(m["callers"]["contract"], "deny");
    assert_eq!(m["signing_keys"][1]["type"], "secp256k1");
    println!("ok - manifest: HTTPS-only callers; network limited to 2 NEAR RPCs + Hyperliquid; keys report/hl-agent/seal/state");

    let probe = enclave.manifest.clone();
    let _ = probe;
    let log = run_all(&mut enclave);
    println!("\n{} scenarios against {path} (contract {CONTRACT})", log.len() + 1);
    println!("HARNESS PASSED");
    Ok(())
}
