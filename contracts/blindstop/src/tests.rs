use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::borsh;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const VECTORS: &str = include_str!("../../../packages/shared/test/vectors.json");

fn vectors() -> near_sdk::serde_json::Value {
    near_sdk::serde_json::from_str(VECTORS).unwrap()
}

fn enclave_key() -> SigningKey {
    SigningKey::from_bytes(&[0x43; 32])
}

fn contract_id() -> AccountId {
    "blindstop.testnet".parse().unwrap()
}

fn ctx(predecessor: &AccountId, deposit: NearToken) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor.clone())
        .attached_deposit(deposit)
        .block_timestamp(1_762_700_000_000_000_000)
        .account_balance(NearToken::from_near(100));
    testing_env!(b.build());
}

fn admin() -> AccountId {
    accounts(0)
}
fn alice() -> AccountId {
    accounts(1)
}
fn mallory() -> AccountId {
    accounts(2)
}

fn new_contract() -> Blindstop {
    ctx(&admin(), NearToken::from_near(0));
    Blindstop::new(
        admin(),
        hex::encode(enclave_key().verifying_key().to_bytes()),
        hex::encode([7u8; 32]),
        "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a".into(),
    )
}

fn deposit() -> NearToken {
    NearToken::from_millinear(20)
}

fn place(c: &mut Blindstop, who: &AccountId, commitment: [u8; 32]) -> u64 {
    ctx(who, deposit());
    c.place_order(Base64VecU8(vec![1u8; CIPHERTEXT_LEN]), hex::encode(commitment)).0
}

fn fire_report(order_id: u64, commitment: [u8; 32], outcome: u8) -> FireReportV1 {
    FireReportV1 {
        contract_id: contract_id().to_string(),
        order_id,
        commitment,
        hl_cloid: [1; 16],
        hl_oid: 42,
        avg_px: "94990.1".into(),
        filled_sz: "0.001".into(),
        outcome,
        ts_ms: 1,
    }
}

fn sign(kind: u8, borsh: &[u8], key: &SigningKey) -> Base64VecU8 {
    Base64VecU8(key.sign(&signed_bytes(kind, borsh)).to_bytes().to_vec())
}

fn submit_fire(c: &mut Blindstop, r: &FireReportV1, key: &SigningKey) {
    ctx(&mallory(), NearToken::from_near(0)); // anyone may submit
    let b = borsh::to_vec(r).unwrap();
    c.record_fire(Base64VecU8(b.clone()), sign(0, &b, key));
}

#[test]
fn place_then_owner_cancels() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    assert_eq!(c.get_active_count(), 1);
    let rows = c.get_active(None, None);
    assert_eq!(rows[0].id.0, id);
    assert_eq!(rows[0].commitment, hex::encode([9u8; 32]));
    ctx(&alice(), NearToken::from_near(0));
    c.cancel_order(U64(id));
    assert_eq!(c.get_order(U64(id)).unwrap().status, Status::Cancelled);
    assert_eq!(c.get_active_count(), 0);
}

#[test]
#[should_panic(expected = "only the order's owner can cancel it")]
fn non_owner_cannot_cancel() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    ctx(&mallory(), NearToken::from_near(0));
    c.cancel_order(U64(id));
}

#[test]
#[should_panic(expected = "ciphertext must be exactly 316 bytes")]
fn wrong_length_ciphertext_refused() {
    let mut c = new_contract();
    ctx(&alice(), deposit());
    c.place_order(Base64VecU8(vec![1u8; 315]), hex::encode([9u8; 32]));
}

#[test]
#[should_panic(expected = "attach at least")]
fn storage_must_be_paid() {
    let mut c = new_contract();
    ctx(&alice(), NearToken::from_yoctonear(1));
    c.place_order(Base64VecU8(vec![1u8; CIPHERTEXT_LEN]), hex::encode([9u8; 32]));
}

#[test]
fn valid_fire_settles_once() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    submit_fire(&mut c, &fire_report(id, [9; 32], 0), &enclave_key());
    let o = c.get_order(U64(id)).unwrap();
    assert_eq!(o.status, Status::Fired);
    assert_eq!(o.fire.unwrap().avg_px, "94990.1");
    assert_eq!(c.get_active_count(), 0);
}

#[test]
#[should_panic(expected = "order is not active")]
fn replayed_fire_refused() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    let r = fire_report(id, [9; 32], 0);
    submit_fire(&mut c, &r, &enclave_key());
    submit_fire(&mut c, &r, &enclave_key());
}

#[test]
#[should_panic(expected = "signature does not verify against the enclave key")]
fn forged_fire_refused() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    submit_fire(&mut c, &fire_report(id, [9; 32], 0), &SigningKey::from_bytes(&[0x66; 32]));
}

#[test]
#[should_panic(expected = "report commitment does not match the order")]
fn report_for_another_order_refused() {
    let mut c = new_contract();
    let a = place(&mut c, &alice(), [9; 32]);
    let b = place(&mut c, &alice(), [8; 32]);
    let _ = a;
    // A valid, enclave-signed report for order A's commitment presented as order B.
    submit_fire(&mut c, &fire_report(b, [9; 32], 0), &enclave_key());
}

#[test]
#[should_panic(expected = "signature does not verify against the enclave key")]
fn heartbeat_signature_cannot_settle_an_order() {
    // A heartbeat signature (kind 1) over the same bytes must not pass as a fire (kind 0).
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    let b = borsh::to_vec(&fire_report(id, [9; 32], 0)).unwrap();
    ctx(&mallory(), NearToken::from_near(0));
    c.record_fire(Base64VecU8(b.clone()), sign(1, &b, &enclave_key()));
}

#[test]
#[should_panic(expected = "report is for another contract")]
fn report_for_other_contract_refused() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    let mut r = fire_report(id, [9; 32], 0);
    r.contract_id = "other.testnet".into();
    submit_fire(&mut c, &r, &enclave_key());
}

#[test]
fn outcomes_map_to_statuses() {
    let mut c = new_contract();
    for (outcome, status) in [(1u8, Status::Skipped), (2, Status::Rejected), (3, Status::Invalid)] {
        let id = place(&mut c, &alice(), [outcome; 32]);
        submit_fire(&mut c, &fire_report(id, [outcome; 32], outcome), &enclave_key());
        assert_eq!(c.get_order(U64(id)).unwrap().status, status);
    }
}

#[test]
fn heartbeat_must_increase() {
    let mut c = new_contract();
    let hb = |t: u64| HeartbeatV1 { contract_id: contract_id().to_string(), tick_ms: t, orders_seen: 0, code_hash: [0; 32] };
    let send = |c: &mut Blindstop, t: u64| {
        let b = borsh::to_vec(&hb(t)).unwrap();
        ctx(&mallory(), NearToken::from_near(0));
        c.heartbeat(Base64VecU8(b.clone()), sign(1, &b, &enclave_key()));
    };
    send(&mut c, 10);
    assert_eq!(c.get_heartbeat().unwrap().tick_ms.0, 10);
    send(&mut c, 11);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| send(&mut c, 11)));
    assert!(r.is_err(), "non-increasing heartbeat must be refused");
}

#[test]
fn reveal_checks_preimage_and_timing() {
    let v = vectors();
    let case = &v["orders"][0];
    let borsh_bytes = hex::decode(case["borsh"].as_str().unwrap()).unwrap();
    let commitment: [u8; 32] = hex::decode(case["commitment"].as_str().unwrap()).unwrap().try_into().unwrap();
    // The contract computes the same commitment as Rust core and TypeScript.
    assert_eq!(commitment_of(&borsh_bytes), commitment);

    let mut c = new_contract();
    let id = place(&mut c, &alice(), commitment);

    // Not while active.
    ctx(&alice(), deposit());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.reveal(U64(id), Base64VecU8(borsh_bytes.clone()))));
    assert!(r.is_err());

    ctx(&alice(), NearToken::from_near(0));
    c.cancel_order(U64(id));

    // Wrong preimage.
    let mut wrong = borsh_bytes.clone();
    wrong[40] ^= 1;
    ctx(&alice(), deposit());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.reveal(U64(id), Base64VecU8(wrong.clone()))));
    assert!(r.is_err());

    // Not by someone else.
    ctx(&mallory(), deposit());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.reveal(U64(id), Base64VecU8(borsh_bytes.clone()))));
    assert!(r.is_err());

    // The owner, with the right preimage.
    ctx(&alice(), deposit());
    c.reveal(U64(id), Base64VecU8(borsh_bytes));
    let view = c.get_order(U64(id)).unwrap();
    let shown = view.revealed_order.unwrap();
    assert_eq!(shown.coin, "BTC");
    assert_eq!(shown.trigger_px, "95000.5");
    assert_eq!(shown.kind, "stop_loss");
}

#[test]
fn per_owner_cap_and_pause() {
    let mut c = new_contract();
    ctx(&admin(), NearToken::from_near(0));
    c.set_max_active_per_owner(2);
    let a = place(&mut c, &alice(), [1; 32]);
    place(&mut c, &alice(), [2; 32]);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| place(&mut c, &alice(), [3; 32])));
    assert!(r.is_err(), "third active order must be refused");
    // Another account is unaffected.
    place(&mut c, &mallory(), [4; 32]);

    ctx(&admin(), NearToken::from_near(0));
    c.pause();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| place(&mut c, &mallory(), [5; 32])));
    assert!(r.is_err(), "paused must refuse new orders");
    // Cancel still works while paused, and frees a slot.
    ctx(&alice(), NearToken::from_near(0));
    c.cancel_order(U64(a));
    ctx(&admin(), NearToken::from_near(0));
    c.unpause();
    place(&mut c, &alice(), [6; 32]);
}

#[test]
#[should_panic(expected = "owner only")]
fn only_owner_rotates_keys() {
    let mut c = new_contract();
    ctx(&mallory(), NearToken::from_near(0));
    c.set_enclave_keys(hex::encode([1u8; 32]), hex::encode([2u8; 32]), "0x0000000000000000000000000000000000000001".into());
}

#[test]
fn key_rotation_bumps_epoch_and_old_key_stops_verifying() {
    let mut c = new_contract();
    let id = place(&mut c, &alice(), [9; 32]);
    let new_key = SigningKey::from_bytes(&[0x77; 32]);
    ctx(&admin(), NearToken::from_near(0));
    c.set_enclave_keys(
        hex::encode(new_key.verifying_key().to_bytes()),
        hex::encode([2u8; 32]),
        "0x0000000000000000000000000000000000000001".into(),
    );
    assert_eq!(c.get_enclave_keys().key_epoch, 2);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c2 = c.clone_for_test();
        submit_fire(&mut c2, &fire_report(id, [9; 32], 0), &enclave_key());
    }));
    assert!(r.is_err());
    submit_fire(&mut c, &fire_report(id, [9; 32], 0), &new_key);
    assert_eq!(c.get_order(U64(id)).unwrap().status, Status::Fired);
}

#[test]
fn shared_vector_reports_verify_in_the_contract() {
    let v = vectors();
    let enclave_pub: [u8; 32] = hex::decode(v["enclave"]["ed25519_public"].as_str().unwrap()).unwrap().try_into().unwrap();
    assert_eq!(enclave_pub, enclave_key().verifying_key().to_bytes());
    for (name, kind) in [("fire", 0u8), ("heartbeat", 1u8)] {
        let r = &v["reports"][name];
        let b = hex::decode(r["borsh"].as_str().unwrap()).unwrap();
        assert_eq!(hex::encode(signed_bytes(kind, &b)), r["signed_bytes"].as_str().unwrap());
        let sig: [u8; 64] = hex::decode(r["sig"].as_str().unwrap()).unwrap().try_into().unwrap();
        ctx(&admin(), NearToken::from_near(0));
        assert!(env::ed25519_verify(&sig, &signed_bytes(kind, &b), &enclave_pub), "{name}");
    }
    let fire = FireReportV1::try_from_slice_checked(&hex::decode(v["reports"]["fire"]["borsh"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(fire.order_id, 7);
    assert_eq!(fire.avg_px, "94990.1");
    let order = SealedOrderV1::try_from_slice_checked(&hex::decode(v["orders"][1]["borsh"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(order.coin, "ETH");
    assert_eq!(order.size, "0.0123");
}

impl Blindstop {
    /// Collections share storage through the mocked blockchain, so a "clone" for a panicking
    /// sub-test is just a re-read of the same state.
    fn clone_for_test(&self) -> Blindstop {
        near_sdk::borsh::from_slice(&near_sdk::borsh::to_vec(self).unwrap()).unwrap()
    }
}
