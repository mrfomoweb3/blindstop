//! Stored records, the wire formats shared with the enclave (borsh, byte-identical to
//! `enclave/core`), and JSON views.

use near_sdk::borsh::BorshDeserialize;
use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Active,
    /// Closed on Hyperliquid by the enclave.
    Fired,
    Cancelled,
    /// Triggered, but there was no matching position to close.
    Skipped,
    /// Hyperliquid refused or did not fill the close on every attempt.
    Rejected,
    /// The ciphertext did not open, or failed the enclave's checks.
    Invalid,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FireReportV1 {
    pub contract_id: String,
    pub order_id: u64,
    pub commitment: [u8; 32],
    pub hl_cloid: [u8; 16],
    pub hl_oid: u64,
    pub avg_px: String,
    pub filled_sz: String,
    pub outcome: u8,
    pub ts_ms: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeartbeatV1 {
    pub contract_id: String,
    pub tick_ms: u64,
    pub orders_seen: u32,
    pub code_hash: [u8; 32],
}

/// The sealed order's plaintext, decoded only when its owner reveals it.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SealedOrderV1 {
    pub version: u8,
    pub hl_network: u8,
    pub hl_address: [u8; 20],
    pub coin: String,
    pub position_side: u8,
    pub kind: u8,
    pub trigger_px: String,
    pub size: String,
    pub slippage_bps: u16,
    pub confirm_ticks: u8,
    pub created_ms: u64,
    pub salt: [u8; 32],
    pub wallet_sig: [u8; 65],
}

pub trait CheckedDecode: Sized {
    /// Borsh decode that refuses trailing bytes.
    fn try_from_slice_checked(b: &[u8]) -> Option<Self>;
}

impl<T: BorshDeserialize> CheckedDecode for T {
    fn try_from_slice_checked(b: &[u8]) -> Option<Self> {
        T::try_from_slice(b).ok()
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Order {
    pub owner: AccountId,
    /// Emptied when the order closes; the storage it held is refunded.
    pub ciphertext: Vec<u8>,
    pub commitment: [u8; 32],
    pub status: Status,
    /// Block time the order was placed: the provable "set before" time.
    pub created_ns: u64,
    pub created_height: u64,
    pub closed_ns: Option<u64>,
    pub fire: Option<FireReportV1>,
    pub revealed: Option<Vec<u8>>,
    pub key_epoch: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveOrderRow {
    pub id: U64,
    pub owner: AccountId,
    /// standard base64
    pub ciphertext: String,
    /// hex
    pub commitment: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FireReportView {
    pub order_id: U64,
    pub hl_cloid: String,
    pub hl_oid: U64,
    pub avg_px: String,
    pub filled_sz: String,
    pub outcome: u8,
    pub ts_ms: U64,
}

impl FireReportV1 {
    pub fn to_view(&self) -> FireReportView {
        FireReportView {
            order_id: U64(self.order_id),
            hl_cloid: format!("0x{}", hex::encode(self.hl_cloid)),
            hl_oid: U64(self.hl_oid),
            avg_px: self.avg_px.clone(),
            filled_sz: self.filled_sz.clone(),
            outcome: self.outcome,
            ts_ms: U64(self.ts_ms),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevealedOrderView {
    pub hl_network: String,
    pub hl_address: String,
    pub coin: String,
    pub position_side: String,
    pub kind: String,
    pub trigger_px: String,
    pub size: String,
    pub slippage_bps: u16,
    pub confirm_ticks: u8,
    pub created_ms: U64,
}

impl SealedOrderV1 {
    pub fn to_view(&self) -> RevealedOrderView {
        RevealedOrderView {
            hl_network: if self.hl_network == 0 { "mainnet" } else { "testnet" }.into(),
            hl_address: format!("0x{}", hex::encode(self.hl_address)),
            coin: self.coin.clone(),
            position_side: if self.position_side == 0 { "long" } else { "short" }.into(),
            kind: if self.kind == 0 { "stop_loss" } else { "take_profit" }.into(),
            trigger_px: self.trigger_px.clone(),
            size: self.size.clone(),
            slippage_bps: self.slippage_bps,
            confirm_ticks: self.confirm_ticks,
            created_ms: U64(self.created_ms),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderView {
    pub id: U64,
    pub owner: AccountId,
    pub commitment: String,
    pub status: Status,
    pub created_ns: U64,
    pub created_height: U64,
    pub closed_ns: Option<U64>,
    pub fire: Option<FireReportView>,
    /// base64 borsh plaintext, once revealed
    pub revealed: Option<String>,
    pub revealed_order: Option<RevealedOrderView>,
    pub key_epoch: u32,
}

impl Order {
    pub fn to_view(&self, id: u64) -> OrderView {
        use near_sdk::base64::Engine;
        OrderView {
            id: U64(id),
            owner: self.owner.clone(),
            commitment: hex::encode(self.commitment),
            status: self.status,
            created_ns: U64(self.created_ns),
            created_height: U64(self.created_height),
            closed_ns: self.closed_ns.map(U64),
            fire: self.fire.as_ref().map(FireReportV1::to_view),
            revealed: self.revealed.as_ref().map(|b| near_sdk::base64::engine::general_purpose::STANDARD.encode(b)),
            revealed_order: self
                .revealed
                .as_ref()
                .and_then(|b| SealedOrderV1::try_from_slice_checked(b))
                .map(|o| o.to_view()),
            key_epoch: self.key_epoch,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnclaveKeys {
    pub enclave_ed25519: String,
    pub enclave_x25519: String,
    pub agent_address: String,
    pub key_epoch: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeartbeatView {
    pub tick_ms: U64,
    pub orders_seen: u32,
    pub code_hash: String,
}

impl HeartbeatV1 {
    pub fn to_view(&self) -> HeartbeatView {
        HeartbeatView { tick_ms: U64(self.tick_ms), orders_seen: self.orders_seen, code_hash: hex::encode(self.code_hash) }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner: AccountId,
    pub paused: bool,
    pub max_active_per_owner: u32,
    pub next_id: U64,
    pub ciphertext_len: u32,
    pub storage_byte_cost: U128,
}
