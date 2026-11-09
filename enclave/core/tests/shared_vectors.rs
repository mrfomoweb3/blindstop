//! The committed `packages/shared/test/vectors.json` must be exactly what the Rust code
//! produces, and every envelope in it must open under the enclave key.

#[path = "common/vectors.rs"]
mod vectors;

use blindstop_core::order::{self, SealedOrderV1};
use blindstop_core::seal;
use blindstop_core::tick::open_order;
use blindstop_core::near::ActiveOrder;

const FILE: &str = include_str!("../../../packages/shared/test/vectors.json");

#[test]
fn committed_vectors_match_rust() {
    let committed: serde_json::Value = serde_json::from_str(FILE).unwrap();
    assert_eq!(
        committed,
        vectors::build(),
        "packages/shared/test/vectors.json drifted; regenerate with `cargo run -p blindstop-core --example vectors`"
    );
}

#[test]
fn every_envelope_opens_and_passes_the_enclave_checks() {
    let v = vectors::build();
    let sk = seal::secret_from_seed(vectors::ENCLAVE_X25519_SEED);
    for c in v["orders"].as_array().unwrap() {
        let commitment: [u8; 32] = hex::decode(c["commitment"].as_str().unwrap()).unwrap().try_into().unwrap();
        let row = ActiveOrder {
            id: 1,
            owner: vectors::OWNER.into(),
            ciphertext: hex::decode(c["envelope"].as_str().unwrap()).unwrap(),
            commitment,
        };
        let (o, _) = open_order(&sk, vectors::CONTRACT, &row).expect("opens");
        assert_eq!(hex::encode(o.to_bytes()), c["borsh"].as_str().unwrap());
        // The same ciphertext under another owner must not open (AAD binds the owner).
        let stolen = ActiveOrder { owner: "mallory.testnet".into(), ..row.clone() };
        assert!(open_order(&sk, vectors::CONTRACT, &stolen).is_err());
    }
}

#[test]
fn order_for_someone_elses_wallet_is_refused() {
    use blindstop_core::hl::signing::{personal_message_hash, AgentSigner, LocalSigner};
    let sk = seal::secret_from_seed(vectors::ENCLAVE_X25519_SEED);
    let pk = seal::public_of(&sk);
    let seal_row = |o: &SealedOrderV1, owner: &str, id: u64| {
        let borsh = o.to_bytes();
        let commitment = order::commitment_of(&borsh);
        let aad = seal::aad(vectors::CONTRACT, owner, &commitment);
        let env = seal::seal(&pk, [1; 32], [2; 12], &order::pad(&borsh).unwrap(), &aad).unwrap();
        ActiveOrder { id, owner: owner.into(), ciphertext: env, commitment }
    };

    // 1. Mallory names Alice's trading wallet and signs the binding with her own key.
    let mut o: SealedOrderV1 = vectors::sample_order("BTC", 0, 0, "1", "ALL");
    let msg = order::wallet_binding_message(vectors::CONTRACT, "mallory.testnet", false);
    let mut mallory_key = LocalSigner::from_bytes(&[0x99; 32]).unwrap();
    let mut sig = mallory_key.sign_prehash(&personal_message_hash(msg.as_bytes())).unwrap();
    sig[64] += 27;
    o.wallet_sig = sig;
    assert_eq!(
        open_order(&sk, vectors::CONTRACT, &seal_row(&o, "mallory.testnet", 9)).unwrap_err(),
        "wallet signature is not from the trading wallet"
    );

    // 2. Mallory replays Alice's real binding (signed for alice.testnet) under her own account.
    let o2 = vectors::sample_order("BTC", 0, 0, "1", "ALL"); // carries Alice's binding
    assert_eq!(
        open_order(&sk, vectors::CONTRACT, &seal_row(&o2, "mallory.testnet", 10)).unwrap_err(),
        "wallet signature is not from the trading wallet"
    );

    // 3. Alice's own order opens.
    assert!(open_order(&sk, vectors::CONTRACT, &seal_row(&o2, vectors::OWNER, 11)).is_ok());

    // 4. A testnet binding does not authorize a mainnet order.
    let mut o4 = vectors::sample_order("BTC", 0, 0, "1", "ALL");
    o4.hl_network = order::NETWORK_MAINNET;
    assert!(open_order(&sk, vectors::CONTRACT, &seal_row(&o4, vectors::OWNER, 12)).is_err());
}
