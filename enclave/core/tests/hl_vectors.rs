//! Spike S1: the Rust signer reproduces the official Python SDK byte for byte.
//! Vectors: `scripts/hl_vectors.py` → `tests/hl_vectors.json`.

use blindstop_core::decimal::Dec;
use blindstop_core::hl::api::{close_order_action, CloseOrder};
use blindstop_core::hl::signing::{
    action_hash, address_hex, personal_message_hash, recover_address, sign_l1_action, LocalSigner,
};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("hl_vectors.json")).unwrap()
}

fn key(hex32: &str) -> [u8; 32] {
    hex::decode(hex32.trim_start_matches("0x")).unwrap().try_into().unwrap()
}

#[test]
fn l1_order_vectors_match_python_sdk() {
    let v = vectors();
    let mut signer = LocalSigner::from_bytes(&key(v["agent_key"].as_str().unwrap())).unwrap();
    assert_eq!(address_hex(&signer.address()), v["agent_address"].as_str().unwrap().to_lowercase());
    let cases = v["l1"].as_array().unwrap();
    assert!(cases.len() >= 5);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let cloid: [u8; 16] = hex::decode(c["cloid"].as_str().unwrap().trim_start_matches("0x")).unwrap().try_into().unwrap();
        let action = close_order_action(&CloseOrder {
            asset: c["asset"].as_u64().unwrap() as u32,
            is_buy: c["is_buy"].as_bool().unwrap(),
            px: Dec::parse(c["px"].as_str().unwrap()).unwrap(),
            sz: Dec::parse(c["sz"].as_str().unwrap()).unwrap(),
            cloid,
        });
        assert_eq!(action.to_json().to_string(), c["action_json"].as_str().unwrap(), "{name}: action json");
        assert_eq!(hex::encode(action.encode()), c["msgpack_hex"].as_str().unwrap(), "{name}: msgpack");
        let nonce = c["nonce"].as_u64().unwrap();
        let cid = action_hash(&action, nonce, None);
        assert_eq!(format!("0x{}", hex::encode(cid)), c["connection_id"].as_str().unwrap(), "{name}: connectionId");
        let sig = sign_l1_action(&mut signer, &action, nonce, None, c["is_mainnet"].as_bool().unwrap()).unwrap();
        let want = &c["signature"];
        assert_eq!(format!("0x{}", hex::encode(sig.r)), want["r"].as_str().unwrap(), "{name}: r");
        assert_eq!(format!("0x{}", hex::encode(sig.s)), want["s"].as_str().unwrap(), "{name}: s");
        assert_eq!(sig.v as u64, want["v"].as_u64().unwrap(), "{name}: v");
    }
}

#[test]
fn personal_sign_vectors_recover() {
    let v = vectors();
    for c in v["personal_sign"].as_array().unwrap() {
        let msg = c["message"].as_str().unwrap();
        let sig: [u8; 65] = hex::decode(c["signature"].as_str().unwrap().trim_start_matches("0x")).unwrap().try_into().unwrap();
        let addr = recover_address(&personal_message_hash(msg.as_bytes()), &sig).unwrap();
        assert_eq!(address_hex(&addr), c["signer"].as_str().unwrap().to_lowercase(), "{msg:?}");
    }
}
