//! Blindstop: sealed stop-losses and take-profits for Hyperliquid, settled on NEAR.
//!
//! The contract stores only ciphertext and a commitment for each order. It never learns the
//! level, the size, the market or the trading wallet. The OutLayer enclave reads the active
//! set, decides, acts on Hyperliquid, and returns an ed25519-signed report; anyone may submit
//! that report and the contract checks it against the pinned enclave key.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::{IterableSet, LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
};

mod types;
pub use types::*;

/// eph_pub(32) ‖ nonce(12) ‖ ciphertext(256) ‖ tag(16)
pub const CIPHERTEXT_LEN: usize = 316;
pub const COMMITMENT_DOMAIN: &[u8] = b"blindstop:v1:order";
pub const REPORT_DOMAIN: &[u8] = b"blindstop:v1:report";
pub const DEFAULT_MAX_ACTIVE_PER_OWNER: u32 = 20;
pub const MAX_PAGE: u32 = 200;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Orders,
    Active,
    OwnerOrders,
    OwnerOrderList { owner_hash: Vec<u8> },
    ActiveCount,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Blindstop {
    owner: AccountId,
    enclave_ed25519: [u8; 32],
    enclave_x25519: [u8; 32],
    agent_address: String,
    /// Bumped by every key rotation; orders remember the epoch they were sealed under.
    key_epoch: u32,
    orders: LookupMap<u64, Order>,
    active_ids: IterableSet<u64>,
    owner_orders: LookupMap<AccountId, Vector<u64>>,
    active_count: LookupMap<AccountId, u32>,
    next_id: u64,
    last_heartbeat: Option<HeartbeatV1>,
    max_active_per_owner: u32,
    paused: bool,
}

fn parse_key32(name: &str, hex_str: &str) -> [u8; 32] {
    let b = hex::decode(hex_str).unwrap_or_else(|_| env::panic_str(&format!("{name}: not hex")));
    b.try_into().unwrap_or_else(|_| env::panic_str(&format!("{name}: must be 32 bytes")))
}

fn check_agent_address(a: &str) {
    require!(
        a.len() == 42 && a.starts_with("0x") && a[2..].bytes().all(|b| b.is_ascii_hexdigit()),
        "agent_address must be a 0x-prefixed 20-byte hex address"
    );
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let ev = near_sdk::serde_json::json!({
        "standard": "blindstop",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

fn signed_bytes(kind: u8, report_borsh: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(REPORT_DOMAIN.len() + 1 + report_borsh.len());
    v.extend_from_slice(REPORT_DOMAIN);
    v.push(kind);
    v.extend_from_slice(report_borsh);
    v
}

pub fn commitment_of(order_borsh: &[u8]) -> [u8; 32] {
    let mut pre = Vec::with_capacity(COMMITMENT_DOMAIN.len() + order_borsh.len());
    pre.extend_from_slice(COMMITMENT_DOMAIN);
    pre.extend_from_slice(order_borsh);
    env::sha256(&pre).try_into().expect("sha256 is 32 bytes")
}

#[near]
impl Blindstop {
    #[init]
    pub fn new(owner: AccountId, enclave_ed25519: String, enclave_x25519: String, agent_address: String) -> Self {
        check_agent_address(&agent_address);
        Self {
            owner,
            enclave_ed25519: parse_key32("enclave_ed25519", &enclave_ed25519),
            enclave_x25519: parse_key32("enclave_x25519", &enclave_x25519),
            agent_address: agent_address.to_lowercase(),
            key_epoch: 1,
            orders: LookupMap::new(Key::Orders),
            active_ids: IterableSet::new(Key::Active),
            owner_orders: LookupMap::new(Key::OwnerOrders),
            active_count: LookupMap::new(Key::ActiveCount),
            next_id: 1,
            last_heartbeat: None,
            max_active_per_owner: DEFAULT_MAX_ACTIVE_PER_OWNER,
            paused: false,
        }
    }

    // ───────────────────────── users ─────────────────────────

    /// Seal a stop. `ciphertext` is the fixed-size envelope; `commitment` is
    /// sha256("blindstop:v1:order" ‖ borsh(order)) in hex. Attach enough NEAR for storage;
    /// the rest is refunded.
    #[payable]
    pub fn place_order(&mut self, ciphertext: Base64VecU8, commitment: String) -> U64 {
        require!(!self.paused, "paused: new orders are not accepted right now");
        require!(ciphertext.0.len() == CIPHERTEXT_LEN, "ciphertext must be exactly 316 bytes");
        let commitment = parse_key32("commitment", &commitment);
        let owner = env::predecessor_account_id();
        let active = self.active_count.get(&owner).copied().unwrap_or(0);
        require!(active < self.max_active_per_owner, "too many active orders for this account");

        let before = env::storage_usage();
        let id = self.next_id;
        self.next_id += 1;
        let order = Order {
            owner: owner.clone(),
            ciphertext: ciphertext.0,
            commitment,
            status: Status::Active,
            created_ns: env::block_timestamp(),
            created_height: env::block_height(),
            closed_ns: None,
            fire: None,
            revealed: None,
            key_epoch: self.key_epoch,
        };
        self.orders.insert(id, order);
        self.active_ids.insert(id);
        self.active_count.insert(owner.clone(), active + 1);
        self.push_owner_order(&owner, id);
        self.orders.flush();
        self.active_ids.flush();
        self.active_count.flush();
        self.owner_orders.flush();

        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(used as u128);
        let deposit = env::attached_deposit();
        require!(
            deposit >= cost,
            format!("attach at least {} yoctoNEAR for storage", cost.as_yoctonear())
        );
        let refund = deposit.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(owner.clone()).transfer(refund).detach();
        }
        emit(
            "order_placed",
            near_sdk::serde_json::json!({
                "order_id": U64(id),
                "owner": owner,
                "commitment": hex::encode(commitment),
                "key_epoch": self.key_epoch,
            }),
        );
        U64(id)
    }

    /// Owner only. Works while paused.
    pub fn cancel_order(&mut self, order_id: U64) {
        let id = order_id.0;
        let order = self.orders.get(&id).unwrap_or_else(|| env::panic_str("no such order"));
        require!(order.owner == env::predecessor_account_id(), "only the order's owner can cancel it");
        require!(order.status == Status::Active, "order is not active");
        self.close(id, Status::Cancelled, None);
        emit("order_cancelled", near_sdk::serde_json::json!({ "order_id": order_id }));
    }

    /// Publish the plaintext of a closed order. The contract recomputes the commitment, so a
    /// wrong preimage is refused. Active orders cannot be revealed: that would publish the stop.
    #[payable]
    pub fn reveal(&mut self, order_id: U64, plaintext: Base64VecU8) {
        let id = order_id.0;
        let mut order = self.orders.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such order"));
        require!(order.owner == env::predecessor_account_id(), "only the order's owner can reveal it");
        require!(order.status != Status::Active, "reveal an order after it closes; revealing an active stop would publish it");
        require!(order.revealed.is_none(), "already revealed");
        require!(commitment_of(&plaintext.0) == order.commitment, "preimage does not match the commitment");
        let parsed = SealedOrderV1::try_from_slice_checked(&plaintext.0)
            .unwrap_or_else(|| env::panic_str("preimage is not a SealedOrderV1"));

        let before = env::storage_usage();
        order.revealed = Some(plaintext.0);
        self.orders.insert(id, order);
        self.orders.flush();
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(used as u128);
        let deposit = env::attached_deposit();
        require!(deposit >= cost, format!("attach at least {} yoctoNEAR for storage", cost.as_yoctonear()));
        let refund = deposit.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
        emit(
            "order_revealed",
            near_sdk::serde_json::json!({ "order_id": order_id, "order": parsed.to_view() }),
        );
    }

    // ───────────────────────── the watcher ─────────────────────────

    /// Anyone may submit an enclave report. Verified against the pinned ed25519 key; the
    /// commitment must match and the order must still be active, so a replay, a forgery or a
    /// report for another order is refused.
    pub fn record_fire(&mut self, report: Base64VecU8, sig: Base64VecU8) {
        let r = FireReportV1::try_from_slice_checked(&report.0).unwrap_or_else(|| env::panic_str("report does not decode"));
        self.verify(0, &report.0, &sig.0);
        require!(r.contract_id == env::current_account_id().as_str(), "report is for another contract");
        let order = self.orders.get(&r.order_id).unwrap_or_else(|| env::panic_str("no such order"));
        require!(order.status == Status::Active, "order is not active (already settled or cancelled)");
        require!(order.commitment == r.commitment, "report commitment does not match the order");
        let status = match r.outcome {
            0 => Status::Fired,
            1 => Status::Skipped,
            2 => Status::Rejected,
            3 => Status::Invalid,
            _ => env::panic_str("unknown outcome"),
        };
        let view = r.to_view();
        let id = r.order_id;
        self.close(id, status, Some(r));
        emit("order_fired", near_sdk::serde_json::json!({ "order_id": U64(id), "status": status, "report": view }));
    }

    pub fn heartbeat(&mut self, report: Base64VecU8, sig: Base64VecU8) {
        let hb = HeartbeatV1::try_from_slice_checked(&report.0).unwrap_or_else(|| env::panic_str("heartbeat does not decode"));
        self.verify(1, &report.0, &sig.0);
        require!(hb.contract_id == env::current_account_id().as_str(), "heartbeat is for another contract");
        if let Some(last) = &self.last_heartbeat {
            require!(hb.tick_ms > last.tick_ms, "heartbeat tick must increase");
        }
        emit(
            "heartbeat",
            near_sdk::serde_json::json!({ "tick_ms": U64(hb.tick_ms), "orders_seen": hb.orders_seen }),
        );
        self.last_heartbeat = Some(hb);
    }

    // ───────────────────────── admin ─────────────────────────

    /// Rotate the enclave keys. Orders sealed under the old x25519 key no longer open; the UI
    /// tells their owners to re-seal.
    pub fn set_enclave_keys(&mut self, enclave_ed25519: String, enclave_x25519: String, agent_address: String) {
        self.only_owner();
        check_agent_address(&agent_address);
        self.enclave_ed25519 = parse_key32("enclave_ed25519", &enclave_ed25519);
        self.enclave_x25519 = parse_key32("enclave_x25519", &enclave_x25519);
        self.agent_address = agent_address.to_lowercase();
        self.key_epoch += 1;
        self.last_heartbeat = None;
        emit(
            "enclave_keys_rotated",
            near_sdk::serde_json::json!({
                "key_epoch": self.key_epoch,
                "enclave_ed25519": enclave_ed25519,
                "enclave_x25519": enclave_x25519,
                "agent_address": self.agent_address,
            }),
        );
    }

    pub fn pause(&mut self) {
        self.only_owner();
        self.paused = true;
        emit("paused", near_sdk::serde_json::json!({}));
    }

    pub fn unpause(&mut self) {
        self.only_owner();
        self.paused = false;
        emit("unpaused", near_sdk::serde_json::json!({}));
    }

    pub fn set_max_active_per_owner(&mut self, max: u32) {
        self.only_owner();
        require!(max > 0, "max must be positive");
        self.max_active_per_owner = max;
    }

    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.only_owner();
        emit("ownership_transferred", near_sdk::serde_json::json!({ "from": self.owner, "to": new_owner }));
        self.owner = new_owner;
    }

    // ───────────────────────── views ─────────────────────────

    /// What the enclave scans every tick.
    pub fn get_active(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<ActiveOrderRow> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(100).min(MAX_PAGE) as usize;
        self.active_ids
            .iter()
            .skip(from)
            .take(limit)
            .map(|id| {
                let o = self.orders.get(id).expect("active order exists");
                ActiveOrderRow {
                    id: U64(*id),
                    owner: o.owner.clone(),
                    ciphertext: near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, &o.ciphertext),
                    commitment: hex::encode(o.commitment),
                }
            })
            .collect()
    }

    pub fn get_active_count(&self) -> u32 {
        self.active_ids.len()
    }

    pub fn get_order(&self, order_id: U64) -> Option<OrderView> {
        self.orders.get(&order_id.0).map(|o| o.to_view(order_id.0))
    }

    /// Newest first.
    pub fn get_orders_by_owner(&self, owner: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<OrderView> {
        let Some(list) = self.owner_orders.get(&owner) else { return vec![] };
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(MAX_PAGE);
        let len = list.len();
        (0..len)
            .rev()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|i| list.get(i).and_then(|id| self.orders.get(id).map(|o| o.to_view(*id))))
            .collect()
    }

    pub fn get_enclave_keys(&self) -> EnclaveKeys {
        EnclaveKeys {
            enclave_ed25519: hex::encode(self.enclave_ed25519),
            enclave_x25519: hex::encode(self.enclave_x25519),
            agent_address: self.agent_address.clone(),
            key_epoch: self.key_epoch,
        }
    }

    pub fn get_heartbeat(&self) -> Option<HeartbeatView> {
        self.last_heartbeat.as_ref().map(HeartbeatV1::to_view)
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            paused: self.paused,
            max_active_per_owner: self.max_active_per_owner,
            next_id: U64(self.next_id),
            ciphertext_len: CIPHERTEXT_LEN as u32,
            storage_byte_cost: U128(env::storage_byte_cost().as_yoctonear()),
        }
    }

    // ───────────────────────── internal ─────────────────────────

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn verify(&self, kind: u8, report: &[u8], sig: &[u8]) {
        let sig: [u8; 64] = sig.try_into().unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"));
        require!(
            env::ed25519_verify(&sig, &signed_bytes(kind, report), &self.enclave_ed25519),
            "signature does not verify against the enclave key"
        );
    }

    fn push_owner_order(&mut self, owner: &AccountId, id: u64) {
        if !self.owner_orders.contains_key(owner) {
            let v = Vector::new(Key::OwnerOrderList { owner_hash: env::sha256(owner.as_bytes()) });
            self.owner_orders.insert(owner.clone(), v);
        }
        self.owner_orders.get_mut(owner).expect("just inserted").push(id);
    }

    /// Terminal transition: drop the ciphertext (nobody needs it once closed), refund the
    /// storage it held to the order's owner.
    fn close(&mut self, id: u64, status: Status, fire: Option<FireReportV1>) {
        let before = env::storage_usage();
        let mut order = self.orders.get(&id).cloned().expect("order exists");
        let owner = order.owner.clone();
        order.status = status;
        order.closed_ns = Some(env::block_timestamp());
        order.fire = fire;
        order.ciphertext = Vec::new();
        self.orders.insert(id, order);
        self.active_ids.remove(&id);
        let n = self.active_count.get(&owner).copied().unwrap_or(1);
        if n <= 1 {
            self.active_count.remove(&owner);
        } else {
            self.active_count.insert(owner.clone(), n - 1);
        }
        self.orders.flush();
        self.active_ids.flush();
        self.active_count.flush();
        let freed = before.saturating_sub(env::storage_usage());
        let refund: NearToken = env::storage_byte_cost().saturating_mul(freed as u128);
        if !refund.is_zero() {
            Promise::new(owner).transfer(refund).detach();
        }
    }
}

#[cfg(test)]
mod tests;
