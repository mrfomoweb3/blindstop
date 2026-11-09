//! The Blindstop harness: one set of end-to-end scenarios, run against the real OutLayer wasm
//! (binary `blindstop-harness`) and against the native core (`cargo test`).

pub mod keystore;
pub mod native;
pub mod wasm;
pub mod world;

use base64::Engine;
use blindstop_core::decimal::{round_perp_px, Dec, Rounding};
use blindstop_core::hl::signing::{address_hex, personal_message_hash, AgentSigner, LocalSigner};
use blindstop_core::order::{self, SealedOrderV1};
use blindstop_core::report::{self, FireReportV1, HeartbeatV1, ReportKind};
use blindstop_core::seal;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use keystore::Keystore;
use serde_json::{json, Value as Json};
use std::sync::{Arc, Mutex};
use world::{ExchangeMode, Row, World};

pub const CONTRACT: &str = "blindstop-harness.testnet";
pub const KEYSTORE_MASTER: [u8; 32] = [0x5a; 32];
pub const ALICE: &str = "alice.testnet";
pub const MALLORY: &str = "mallory.testnet";
pub const ALICE_WALLET_KEY: [u8; 32] = [0x22; 32];

pub trait Enclave {
    fn call(&mut self, world: &Arc<Mutex<World>>, input: &str) -> Json;
    fn name(&self) -> &'static str;
}

pub fn keystore() -> Keystore {
    Keystore::new(KEYSTORE_MASTER)
}

struct Ctx<'a> {
    e: &'a mut dyn Enclave,
    world: Arc<Mutex<World>>,
    x25519: [u8; 32],
    ed25519: VerifyingKey,
    agent: String,
    wallet: LocalSigner,
    log: Vec<String>,
    next_id: u64,
}

fn b64(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).expect("base64")
}

impl Ctx<'_> {
    fn ok(&mut self, what: impl Into<String>) {
        let w = what.into();
        println!("ok - {w}");
        self.log.push(w);
    }

    fn tick_with(&mut self, input: &str) -> Json {
        let out = self.e.call(&self.world, input);
        // Nothing order-specific may ever reach the keeper: no coin, level, size or wallet.
        let s = out.to_string();
        for secret in ["\"BTC", "\"ETH", "\"SOL", "70000", "60000", "2500", "ALL", &address_hex(&self.wallet.address())[2..]] {
            assert!(!s.contains(secret), "tick output leaks {secret:?}: {s}");
        }
        out
    }

    fn tick(&mut self) -> Json {
        self.tick_with(r#"{"op":"tick"}"#)
    }

    fn binding_sig(&mut self, owner: &str, signer: &mut LocalSigner) -> [u8; 65] {
        let msg = order::wallet_binding_message(CONTRACT, owner, false);
        let mut sig = signer.sign_prehash(&personal_message_hash(msg.as_bytes())).unwrap();
        sig[64] += 27;
        sig
    }

    #[allow(clippy::too_many_arguments)]
    fn place(&mut self, owner: &str, coin: &str, side: u8, kind: u8, trigger: &str, size: &str, confirm: u8) -> u64 {
        let mut w = LocalSigner::from_bytes(&ALICE_WALLET_KEY).unwrap();
        let sig = self.binding_sig(owner, &mut w);
        let o = SealedOrderV1 {
            version: 1,
            hl_network: order::NETWORK_TESTNET,
            hl_address: self.wallet.address(),
            coin: coin.into(),
            position_side: side,
            kind,
            trigger_px: trigger.into(),
            size: size.into(),
            slippage_bps: 100,
            confirm_ticks: confirm,
            created_ms: 1_762_700_000_000,
            salt: [self.next_id as u8; 32],
            wallet_sig: sig,
        };
        self.insert(owner, &o)
    }

    fn insert(&mut self, owner: &str, o: &SealedOrderV1) -> u64 {
        let borsh = o.to_bytes();
        let commitment = order::commitment_of(&borsh);
        let env = seal::seal(&self.x25519, [self.next_id as u8 + 1; 32], [7; 12], &order::pad(&borsh).unwrap(), &seal::aad(CONTRACT, owner, &commitment)).unwrap();
        self.add_row(owner, env, commitment)
    }

    fn add_row(&mut self, owner: &str, ciphertext: Vec<u8>, commitment: [u8; 32]) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.world.lock().unwrap().orders.insert(id, Row { id, owner: owner.into(), ciphertext, commitment });
        id
    }

    fn settle(&mut self, id: u64) {
        self.world.lock().unwrap().orders.remove(&id);
    }

    fn exchanges(&self) -> usize {
        self.world.lock().unwrap().exchange_count()
    }

    fn reports(out: &Json) -> Vec<Json> {
        out["reports"].as_array().cloned().unwrap_or_default()
    }

    /// Verify a fire report's signature and decode it.
    fn fire(&self, r: &Json) -> FireReportV1 {
        assert_eq!(r["kind"], 0);
        let bytes = b64(r["report"].as_str().unwrap());
        let sig = Signature::from_slice(&b64(r["sig"].as_str().unwrap())).unwrap();
        self.ed25519.verify(&report::signed_bytes(ReportKind::Fire, &bytes), &sig).expect("fire report signature verifies");
        // A heartbeat-kind signature over the same bytes must not pass as a fire report.
        assert!(self.ed25519.verify(&report::signed_bytes(ReportKind::Heartbeat, &bytes), &sig).is_err());
        borsh::from_slice(&bytes).expect("fire report decodes")
    }

    fn commitment_of(&self, id: u64) -> [u8; 32] {
        self.world.lock().unwrap().orders[&id].commitment
    }

    fn set_mark(&self, coin: &str, px: &str) {
        self.world.lock().unwrap().marks.insert(coin.into(), px.into());
    }

    fn set_position(&self, coin: &str, szi: &str) {
        let user = address_hex(&self.wallet.address());
        self.world.lock().unwrap().set_position(&user, coin, szi);
    }

    fn position(&self, coin: &str) -> Option<String> {
        let user = address_hex(&self.wallet.address());
        self.world.lock().unwrap().position(&user, coin)
    }
}

/// Every scenario, in order. Panics on the first failure.
pub fn run_all(e: &mut dyn Enclave) -> Vec<String> {
    let world = Arc::new(Mutex::new(World::new(CONTRACT)));
    let ks = keystore();
    println!("# enclave: {}", e.name());

    // ── keys ──
    let pk = e.call(&world, r#"{"op":"pubkeys"}"#);
    assert_eq!(pk["ok"], true, "{pk}");
    let p = &pk["pubkeys"];
    let x25519: [u8; 32] = hex::decode(p["x25519"].as_str().unwrap()).unwrap().try_into().unwrap();
    let expected_x = seal::public_of(&seal::secret_from_seed(ks.mac("seal", b"blindstop:v1:x25519").try_into().unwrap()));
    assert_eq!(x25519, expected_x, "x25519 comes from mac(seal)");
    let ed: [u8; 32] = hex::decode(p["ed25519"].as_str().unwrap()).unwrap().try_into().unwrap();
    assert_eq!(ed.to_vec(), ks.ed25519_public("report"));
    let agent = p["agent_address"].as_str().unwrap().to_string();
    assert_eq!(p["contract_id"], CONTRACT);
    world.lock().unwrap().approved_agent = Some(agent.clone());

    let mut c = Ctx {
        e,
        world: world.clone(),
        x25519,
        ed25519: VerifyingKey::from_bytes(&ed).unwrap(),
        agent: agent.clone(),
        wallet: LocalSigner::from_bytes(&ALICE_WALLET_KEY).unwrap(),
        log: vec![],
        next_id: 1,
    };
    c.ok(format!("pubkeys: x25519, ed25519 and agent {agent} come from the keystore"));

    let st = c.e.call(&world, r#"{"op":"selftest"}"#);
    let sig = Signature::from_slice(&hex::decode(st["signature"].as_str().unwrap()).unwrap()).unwrap();
    c.ed25519.verify(blindstop_core::tick::SELFTEST_MESSAGE, &sig).unwrap();
    c.ok("selftest signature verifies");

    // ── an armed stop stays silent ──
    c.set_position("BTC", "0.01");
    let id1 = c.place(ALICE, "BTC", order::SIDE_LONG, order::KIND_STOP_LOSS, "70000", order::SIZE_ALL, 1);
    let out = c.tick();
    assert_eq!(out["ok"], true, "{out}");
    assert!(Ctx::reports(&out).is_empty());
    assert_eq!(c.exchanges(), 0);
    assert!(!c.world.lock().unwrap().requests.iter().any(|u| u.ends_with("/exchange")));
    let hb = &out["heartbeat"];
    let hb_bytes = b64(hb["report"].as_str().unwrap());
    c.ed25519
        .verify(&report::signed_bytes(ReportKind::Heartbeat, &hb_bytes), &Signature::from_slice(&b64(hb["sig"].as_str().unwrap())).unwrap())
        .unwrap();
    let hbv: HeartbeatV1 = borsh::from_slice(&hb_bytes).unwrap();
    assert_eq!((hbv.contract_id.as_str(), hbv.orders_seen), (CONTRACT, 1));
    c.ok("long BTC stop at 70000 with mark 75191: no order sent; signed heartbeat");

    // ── the level is crossed: the enclave closes the position ──
    c.set_mark("BTC", "69999");
    let out = c.tick();
    let reports = Ctx::reports(&out);
    assert_eq!(reports.len(), 1, "{out}");
    let f = c.fire(&reports[0]);
    assert_eq!((f.order_id, f.outcome), (id1, report::OUTCOME_FILLED));
    assert_eq!(f.commitment, c.commitment_of(id1));
    assert_eq!((f.filled_sz.as_str(), f.avg_px.as_str()), ("0.01", "69999"));
    assert_eq!(f.contract_id, CONTRACT);
    {
        let w = c.world.lock().unwrap();
        assert_eq!(w.exchange_calls.len(), 1);
        let x = &w.exchange_calls[0];
        let want_px = round_perp_px(Dec::parse("69999").unwrap().mul_ratio(9900, 10_000, Rounding::Down), 5, Rounding::Down);
        assert_eq!((x.is_buy, x.sz.as_str(), x.px.as_str()), (false, "0.01", want_px.to_wire().as_str()));
        assert_eq!(x.signer, c.agent);
        assert_eq!(x.cloid, format!("0x{}", hex::encode(report::cloid_for(id1, 1))));
    }
    assert_eq!(c.position("BTC").as_deref(), Some("0"));
    c.ok("mark 69999 crosses 70000: reduce-only IOC sell 0.01 @ 69299 signed by the agent; filled report verifies");

    // ── idempotent until the contract records it ──
    let again = c.tick();
    assert_eq!(Ctx::reports(&again), reports, "same bytes re-emitted");
    assert_eq!(c.exchanges(), 1, "no second order");
    c.ok("next tick re-emits the identical report and sends nothing");

    c.settle(id1);
    assert!(Ctx::reports(&c.tick()).is_empty());
    c.ok("after settlement the order is gone from get_active; nothing to do");

    // ── triggered with no position ──
    let id2 = c.place(ALICE, "ETH", order::SIDE_SHORT, order::KIND_TAKE_PROFIT, "2500", order::SIZE_ALL, 1);
    let r = Ctx::reports(&c.tick());
    let f = c.fire(&r[0]);
    assert_eq!((f.order_id, f.outcome), (id2, report::OUTCOME_NO_POSITION));
    assert_eq!(c.exchanges(), 1);
    c.settle(id2);
    c.ok("short ETH take-profit triggers with no ETH position: reported as no_position, nothing sent");

    // ── junk and hostile orders are retired, never acted on ──
    let id3 = c.add_row(ALICE, vec![0xee; seal::ENVELOPE_LEN], [0x33; 32]);
    c.set_position("BTC", "0.5");
    let mut mallory_wallet = LocalSigner::from_bytes(&[0x99; 32]).unwrap();
    let mallory_sig = c.binding_sig(MALLORY, &mut mallory_wallet);
    let hostile = SealedOrderV1 {
        version: 1,
        hl_network: order::NETWORK_TESTNET,
        hl_address: c.wallet.address(), // Alice's wallet
        coin: "BTC".into(),
        position_side: order::SIDE_LONG,
        kind: order::KIND_TAKE_PROFIT,
        trigger_px: "1".into(), // fires immediately
        size: order::SIZE_ALL.into(),
        slippage_bps: 1000,
        confirm_ticks: 1,
        created_ms: 1,
        salt: [9; 32],
        wallet_sig: mallory_sig,
    };
    let id4 = c.insert(MALLORY, &hostile);
    let r = Ctx::reports(&c.tick());
    assert_eq!(r.len(), 2);
    for (rep, id) in r.iter().zip([id3, id4]) {
        let f = c.fire(rep);
        assert_eq!((f.order_id, f.outcome), (id, report::OUTCOME_INVALID));
    }
    assert_eq!(c.exchanges(), 1);
    assert_eq!(c.position("BTC").as_deref(), Some("0.5"), "Alice's position untouched");
    c.settle(id3);
    c.settle(id4);
    c.ok("garbage ciphertext and Mallory's order naming Alice's wallet: both retired as invalid, Alice untouched");

    // ── the two RPCs must agree ──
    let id5 = c.place(ALICE, "BTC", order::SIDE_LONG, order::KIND_STOP_LOSS, "60000", order::SIZE_ALL, 1);
    c.world.lock().unwrap().rpc_b_lies = true;
    let out = c.tick();
    assert_eq!(out["ok"], false);
    assert!(out["error"].as_str().unwrap().contains("disagree"), "{out}");
    c.world.lock().unwrap().rpc_b_lies = false;
    c.ok("NEAR RPC B hides an order: the enclave refuses to act at all");

    // ── the keeper cannot inject prices or orders ──
    let before = c.exchanges();
    let out = c.tick_with(r#"{"op":"tick","marks":{"BTC":"1"},"orders":[{"coin":"BTC","trigger_px":"99999999"}]}"#);
    assert_eq!(out["ok"], true);
    assert!(Ctx::reports(&out).is_empty());
    assert_eq!(c.exchanges(), before);
    c.settle(id5);
    c.ok("tick input carrying fake marks and orders is ignored; nothing fires");

    // ── Hyperliquid refuses: retry, then give up honestly ──
    c.set_position("SOL", "10");
    c.world.lock().unwrap().exchange_mode = ExchangeMode::Reject;
    let id7 = c.place(ALICE, "SOL", order::SIDE_LONG, order::KIND_TAKE_PROFIT, "80", order::SIZE_ALL, 1);
    for attempt in 1..=4 {
        let out = c.tick();
        assert!(Ctx::reports(&out).is_empty(), "attempt {attempt}: {out}");
        assert!(!out["stats"]["errors"].as_array().unwrap().is_empty());
    }
    let r = Ctx::reports(&c.tick());
    let f = c.fire(&r[0]);
    assert_eq!((f.order_id, f.outcome), (id7, report::OUTCOME_REJECTED));
    {
        let w = c.world.lock().unwrap();
        let tries: Vec<&String> = w.exchange_calls.iter().skip(before).map(|x| &x.cloid).collect();
        assert_eq!(tries.len(), 5);
        let mut uniq = tries.clone();
        uniq.dedup();
        assert_eq!(uniq.len(), 5, "a fresh cloid per attempt");
        let nonces: Vec<u64> = w.exchange_calls.iter().map(|x| x.nonce).collect();
        assert!(nonces.windows(2).all(|p| p[1] > p[0]), "agent nonces strictly increase");
    }
    assert_eq!(c.position("SOL").as_deref(), Some("10"));
    c.settle(id7);
    c.ok("Hyperliquid rejects 5 times: 5 attempts with fresh cloids and rising nonces, then reported as rejected");

    // ── the answer is lost after the fill: reconcile by cloid, never double-send ──
    c.world.lock().unwrap().exchange_mode = ExchangeMode::FillThenDrop;
    let id8 = c.place(ALICE, "SOL", order::SIDE_LONG, order::KIND_TAKE_PROFIT, "80", "4", 1);
    let n0 = c.exchanges();
    let out = c.tick();
    assert!(Ctx::reports(&out).is_empty());
    assert_eq!(out["stats"]["pending"], 1);
    assert_eq!(c.position("SOL").as_deref(), Some("6"));
    c.world.lock().unwrap().exchange_mode = ExchangeMode::Fill;
    let r = Ctx::reports(&c.tick());
    let f = c.fire(&r[0]);
    assert_eq!((f.order_id, f.outcome, f.filled_sz.as_str(), f.avg_px.as_str()), (id8, report::OUTCOME_FILLED, "4", "86.615"));
    assert_eq!(c.exchanges(), n0 + 1, "reconciled by orderStatus, not re-sent");
    c.settle(id8);
    c.ok("fill lands but the answer is lost: next tick finds it by cloid and reports it; no second order");

    // ── confirm ticks ──
    let id9 = c.place(ALICE, "SOL", order::SIDE_LONG, order::KIND_STOP_LOSS, "90", order::SIZE_ALL, 2);
    let n0 = c.exchanges();
    assert!(Ctx::reports(&c.tick()).is_empty());
    assert_eq!(c.exchanges(), n0, "first triggered tick only counts");
    let r = Ctx::reports(&c.tick());
    let f = c.fire(&r[0]);
    assert_eq!((f.order_id, f.outcome, f.filled_sz.as_str()), (id9, report::OUTCOME_FILLED, "6"));
    c.settle(id9);
    c.ok("confirm_ticks = 2: waits one tick, then closes the remaining 6 SOL");

    let _ = json!({});
    c.log
}
