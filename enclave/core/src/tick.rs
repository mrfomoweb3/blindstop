//! The watcher loop step. Everything it acts on comes from NEAR and Hyperliquid directly;
//! its input names only the operation, so a lying keeper can delay or skip ticks but never
//! change an outcome.
//!
//! Per order, storage holds a fire record `fire:{id}`:
//!
//! ```text
//!  (none) ──trigger──▶ sending(attempt n, cloid n) ──filled──▶ final(report, sig)
//!                          │                  ▲
//!                          │ rejected         │ next tick, still triggered
//!                          ▼                  │
//!                       failed(attempt n) ────┘          … after MAX_ATTEMPTS: final(rejected)
//! ```
//!
//! `sending` is written (compare-and-swap) BEFORE the order goes out. A tick that finds
//! `sending` asks Hyperliquid what happened to that cloid instead of sending again.

use crate::decimal::{round_perp_px, round_size, Dec, Rounding};
use crate::hl::api::{self, Asset, CloseOrder, KnownStatus, OrderResult};
use crate::hl::signing::{self, AgentSigner};
use crate::near::{self, ActiveOrder, ActiveOrderRow};
use crate::order::{self, CheckedOrder, SealedOrderV1};
use crate::report::{self, FireReportV1, HeartbeatV1, ReportKind};
use crate::seal;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// A stored record and the opaque token a compare-and-swap must present to replace it.
pub struct KvRecord {
    pub value: Vec<u8>,
    pub token: Vec<u8>,
}

/// Everything the tick needs from outside. Inside OutLayer these are TEE host functions;
/// the harness and the tests provide their own.
pub trait Host {
    /// Wall-clock milliseconds since the Unix epoch.
    fn now_ms(&mut self) -> u64;
    /// HTTPS POST with a JSON body; returns the body of a 2xx answer.
    fn http_post(&mut self, url: &str, body: &str) -> Result<String, String>;
    fn kv_get(&mut self, name: &str) -> Result<Option<KvRecord>, String>;
    /// Insert only if absent. `Ok(false)` when a record exists.
    fn kv_insert(&mut self, name: &str, value: &[u8]) -> Result<bool, String>;
    /// Replace only if the stored record is still the one `token` came from.
    fn kv_replace(&mut self, name: &str, token: &[u8], value: &[u8]) -> Result<bool, String>;
    fn kv_delete(&mut self, name: &str) -> Result<(), String>;
    /// 32 bytes of key material for the x25519 sealing key (stable per project + operator).
    fn seal_seed(&mut self) -> Result<[u8; 32], String>;
    fn report_public_key(&mut self) -> Result<[u8; 32], String>;
    fn report_sign(&mut self, message: &[u8]) -> Result<[u8; 64], String>;
    /// 64-byte uncompressed secp256k1 public key (x ‖ y) of the Hyperliquid agent.
    fn agent_public_key(&mut self) -> Result<[u8; 64], String>;
    fn agent_sign_prehash(&mut self, prehash: &[u8; 32]) -> Result<[u8; 65], String>;
}

#[derive(Clone, Debug)]
pub struct Config {
    pub contract_id: String,
    /// Two independent NEAR RPC providers. Both must return identical bytes.
    pub near_rpcs: [String; 2],
    pub max_orders_per_tick: usize,
    pub max_attempts: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct SignedReport {
    pub kind: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_id: Option<String>,
    /// base64(borsh(report))
    pub report: String,
    /// base64(ed25519 signature over signed_bytes(kind, borsh))
    pub sig: String,
}

/// Counts only. Never coins, levels, sizes or wallet addresses: the keeper and its logs see
/// this output.
#[derive(Serialize, Default, Clone, Debug, PartialEq, Eq)]
pub struct Stats {
    pub orders_seen: u32,
    pub processed: u32,
    pub triggered: u32,
    pub sent: u32,
    pub pending: u32,
    pub reports: u32,
    pub invalid: u32,
    pub errors: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct TickOutput {
    pub ok: bool,
    pub contract_id: String,
    pub block_height: u64,
    pub reports: Vec<SignedReport>,
    pub heartbeat: SignedReport,
    pub stats: Stats,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
enum FireRecord {
    Sending { attempt: u32, cloid: String },
    Failed { attempt: u32 },
    Final { report: String, sig: String },
}

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

struct HostAgent<'a>(&'a mut dyn Host);

impl AgentSigner for HostAgent<'_> {
    fn sign_prehash(&mut self, prehash: &[u8; 32]) -> Result<[u8; 65], String> {
        self.0.agent_sign_prehash(prehash)
    }
}

fn post_json(host: &mut dyn Host, url: &str, body: &serde_json::Value) -> Result<String, String> {
    host.http_post(url, &body.to_string())
}

/// Both RPCs, one finalized height (the lower of their two), byte-identical answers.
pub fn read_active(host: &mut dyn Host, cfg: &Config) -> Result<(u64, Vec<ActiveOrder>), String> {
    let mut heights = [0u64; 2];
    for (i, rpc) in cfg.near_rpcs.iter().enumerate() {
        let body = post_json(host, rpc, &near::final_block_request()).map_err(|e| format!("near rpc {i}: {e}"))?;
        heights[i] = near::parse_block_height(&body).map_err(|e| format!("near rpc {i}: {e}"))?;
    }
    let height = heights[0].min(heights[1]);
    let mut rows: Vec<ActiveOrderRow> = Vec::new();
    for page in 0..near::MAX_PAGES {
        let args = near::get_active_args(page * near::PAGE_SIZE, near::PAGE_SIZE);
        let req = near::view_request(&cfg.contract_id, "get_active", &args, height);
        let a = near::parse_view_result(&post_json(host, &cfg.near_rpcs[0], &req).map_err(|e| format!("near rpc 0: {e}"))?)?;
        let b = near::parse_view_result(&post_json(host, &cfg.near_rpcs[1], &req).map_err(|e| format!("near rpc 1: {e}"))?)?;
        if a != b {
            return Err(format!("near rpcs disagree on get_active at block {height}; refusing to act"));
        }
        let page_rows: Vec<ActiveOrderRow> = serde_json::from_slice(&a).map_err(|e| format!("get_active: {e}"))?;
        let n = page_rows.len() as u32;
        rows.extend(page_rows);
        if n < near::PAGE_SIZE {
            break;
        }
    }
    let mut orders = rows.iter().map(ActiveOrderRow::decode).collect::<Result<Vec<_>, _>>()?;
    orders.sort_by_key(|o| o.id);
    orders.dedup_by_key(|o| o.id);
    Ok((height, orders))
}

/// Open, decode, re-commit, check the wallet signature. Any failure means the order is junk.
pub fn open_order(
    seal_secret: &x25519_dalek::StaticSecret,
    contract_id: &str,
    row: &ActiveOrder,
) -> Result<(SealedOrderV1, CheckedOrder), &'static str> {
    let aad = seal::aad(contract_id, &row.owner, &row.commitment);
    let padded = seal::open(seal_secret, &row.ciphertext, &aad).map_err(|_| "does not decrypt")?;
    let bytes = order::unpad(&padded).map_err(|_| "bad padding")?;
    if order::commitment_of(bytes) != row.commitment {
        return Err("commitment mismatch");
    }
    let o = SealedOrderV1::from_bytes(bytes).map_err(|_| "does not decode")?;
    let checked = o.check().map_err(|_| "fails validation")?;
    let msg = order::wallet_binding_message(contract_id, &row.owner, checked.is_mainnet);
    let signer = signing::recover_address(&signing::personal_message_hash(msg.as_bytes()), &o.wallet_sig)
        .map_err(|_| "bad wallet signature")?;
    if signer != o.hl_address {
        return Err("wallet signature is not from the trading wallet");
    }
    Ok((o, checked))
}

fn sign_report(host: &mut dyn Host, kind: ReportKind, borsh: Vec<u8>, order_id: Option<u64>) -> Result<SignedReport, String> {
    let sig = host.report_sign(&report::signed_bytes(kind, &borsh))?;
    Ok(SignedReport {
        kind: kind as u8,
        order_id: order_id.map(|i| i.to_string()),
        report: B64.encode(&borsh),
        sig: B64.encode(sig),
    })
}

fn kv_json<T: for<'de> Deserialize<'de>>(host: &mut dyn Host, name: &str) -> Result<Option<(T, Vec<u8>)>, String> {
    match host.kv_get(name)? {
        None => Ok(None),
        Some(r) => {
            let v = serde_json::from_slice(&r.value).map_err(|e| format!("{name}: corrupt record: {e}"))?;
            Ok(Some((v, r.token)))
        }
    }
}

/// Write `value` at `name`, as an insert when `token` is None, else a compare-and-swap.
fn kv_put(host: &mut dyn Host, name: &str, token: Option<&[u8]>, value: &[u8]) -> Result<bool, String> {
    match token {
        None => host.kv_insert(name, value),
        Some(t) => host.kv_replace(name, t, value),
    }
}

/// A strictly increasing nonce for the agent key: max(now, last + 1).
fn next_nonce(host: &mut dyn Host) -> Result<u64, String> {
    for _ in 0..5 {
        let now = host.now_ms();
        let cur = host.kv_get("hl_nonce")?;
        let last = match &cur {
            Some(r) => u64::from_be_bytes(r.value.as_slice().try_into().map_err(|_| "hl_nonce corrupt")?),
            None => 0,
        };
        let n = now.max(last + 1);
        if kv_put(host, "hl_nonce", cur.as_ref().map(|r| r.token.as_slice()), &n.to_be_bytes())? {
            return Ok(n);
        }
    }
    Err("hl_nonce: contention".into())
}

struct Ctx<'a> {
    cfg: &'a Config,
    now: u64,
    stats: Stats,
    reports: Vec<SignedReport>,
}

impl Ctx<'_> {
    /// Build, sign, store as final (so later ticks re-emit the same bytes), and emit.
    fn finalize(
        &mut self,
        host: &mut dyn Host,
        row: &ActiveOrder,
        token: Option<&[u8]>,
        cloid: [u8; 16],
        oid: u64,
        fill: Option<(Dec, Dec)>,
        outcome: u8,
    ) -> Result<(), String> {
        let r = FireReportV1 {
            contract_id: self.cfg.contract_id.clone(),
            order_id: row.id,
            commitment: row.commitment,
            hl_cloid: cloid,
            hl_oid: oid,
            avg_px: fill.map(|(_, px)| px.to_wire()).unwrap_or_default(),
            filled_sz: fill.map(|(sz, _)| sz.to_wire()).unwrap_or_default(),
            outcome,
            ts_ms: self.now,
        };
        let signed = sign_report(host, ReportKind::Fire, borsh::to_vec(&r).map_err(|e| e.to_string())?, Some(row.id))?;
        let rec = FireRecord::Final { report: signed.report.clone(), sig: signed.sig.clone() };
        let name = format!("fire:{}", row.id);
        if !kv_put(host, &name, token, &serde_json::to_vec(&rec).unwrap())? {
            // Someone else finalized first; their record is the truth. Emit nothing this tick.
            return Ok(());
        }
        self.reports.push(signed);
        self.stats.reports += 1;
        Ok(())
    }
}

fn user_hex(o: &SealedOrderV1) -> String {
    signing::address_hex(&o.hl_address)
}

/// A `sending` record from an earlier tick: ask Hyperliquid what became of that cloid.
/// Returns Some(attempt) if the order may be tried again, None if it is settled or must wait.
fn resolve_sending(
    ctx: &mut Ctx,
    host: &mut dyn Host,
    row: &ActiveOrder,
    o: &SealedOrderV1,
    is_mainnet: bool,
    attempt: u32,
    cloid_hex: &str,
    token: &[u8],
) -> Result<Option<u32>, String> {
    let cloid: [u8; 16] = hex::decode(cloid_hex)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or("fire record: bad cloid")?;
    let base = api::api_base(is_mainnet);
    let status_body = post_json(host, &format!("{base}/info"), &api::order_status_request(&user_hex(o), &cloid))?;
    let status = api::parse_order_status(&status_body)?;
    let fills_of = |host: &mut dyn Host, oid: u64| -> Result<Option<(Dec, Dec)>, String> {
        let body = post_json(host, &format!("{base}/info"), &api::user_fills_request(&user_hex(o)))?;
        api::fills_for_oid(&body, oid)
    };
    match status {
        KnownStatus::Filled { oid } => {
            let fill = fills_of(host, oid)?;
            ctx.finalize(host, row, Some(token), cloid, oid, fill, report::OUTCOME_FILLED)?;
            Ok(None)
        }
        KnownStatus::Open { .. } => {
            ctx.stats.pending += 1;
            Ok(None)
        }
        KnownStatus::Dead { oid, .. } => match fills_of(host, oid)? {
            Some(fill) => {
                ctx.finalize(host, row, Some(token), cloid, oid, Some(fill), report::OUTCOME_FILLED)?;
                Ok(None)
            }
            None => after_failure(ctx, host, row, attempt, cloid, token),
        },
        KnownStatus::Unknown => after_failure(ctx, host, row, attempt, cloid, token),
    }
}

/// A failed attempt: retry on a later tick, or give up after `max_attempts`.
fn after_failure(
    ctx: &mut Ctx,
    host: &mut dyn Host,
    row: &ActiveOrder,
    attempt: u32,
    cloid: [u8; 16],
    token: &[u8],
) -> Result<Option<u32>, String> {
    if attempt >= ctx.cfg.max_attempts {
        ctx.finalize(host, row, Some(token), cloid, 0, None, report::OUTCOME_REJECTED)?;
        return Ok(None);
    }
    let rec = serde_json::to_vec(&FireRecord::Failed { attempt }).unwrap();
    host.kv_replace(&format!("fire:{}", row.id), token, &rec)?;
    Ok(Some(attempt))
}

#[allow(clippy::too_many_arguments)]
fn process_order(
    ctx: &mut Ctx,
    host: &mut dyn Host,
    row: &ActiveOrder,
    o: &SealedOrderV1,
    c: &CheckedOrder,
    asset: &Asset,
) -> Result<(), String> {
    let fire_name = format!("fire:{}", row.id);
    let rec: Option<(FireRecord, Vec<u8>)> = kv_json(host, &fire_name)?;
    let mut prev_attempt = 0u32;
    let mut token: Option<Vec<u8>> = None;
    match rec {
        Some((FireRecord::Final { report, sig }, _)) => {
            // Settled earlier; the contract has not recorded it yet. Re-emit the same bytes.
            ctx.reports.push(SignedReport { kind: ReportKind::Fire as u8, order_id: Some(row.id.to_string()), report, sig });
            ctx.stats.reports += 1;
            return Ok(());
        }
        Some((FireRecord::Sending { attempt, cloid }, t)) => {
            match resolve_sending(ctx, host, row, o, c.is_mainnet, attempt, &cloid, &t)? {
                None => return Ok(()),
                Some(a) => {
                    prev_attempt = a;
                    // The record was just rewritten to `failed`; read its fresh token.
                    token = host.kv_get(&fire_name)?.map(|r| r.token);
                }
            }
        }
        Some((FireRecord::Failed { attempt }, t)) => {
            prev_attempt = attempt;
            token = Some(t);
        }
        None => {}
    }

    let mark = match asset.mark {
        Some(m) => m,
        None => return Ok(()), // no mark (delisted or halted): never trigger on missing data
    };
    let triggered = crate::trigger::is_triggered(c.is_long, c.is_stop_loss, mark, c.trigger);
    let confirm_name = format!("confirm:{}", row.id);
    if !triggered {
        if o.confirm_ticks > 1 {
            host.kv_delete(&confirm_name)?;
        }
        return Ok(());
    }
    if o.confirm_ticks > 1 {
        let cur = host.kv_get(&confirm_name)?;
        let seen = cur.as_ref().and_then(|r| r.value.first().copied()).unwrap_or(0).saturating_add(1);
        kv_put(host, &confirm_name, cur.as_ref().map(|r| r.token.as_slice()), &[seen])?;
        if seen < o.confirm_ticks {
            return Ok(());
        }
    }
    ctx.stats.triggered += 1;

    let base = api::api_base(c.is_mainnet);
    let user = user_hex(o);
    let attempt = prev_attempt + 1;
    let cloid = report::cloid_for(row.id, attempt);

    let pos_body = post_json(host, &format!("{base}/info"), &api::clearinghouse_request(&user))?;
    let position = api::parse_position(&pos_body, &o.coin)?;
    let pos_size = match position {
        Some((is_long, size)) if is_long == c.is_long => size,
        _ => {
            // Flat, or the position flipped: nothing of ours to close.
            return ctx.finalize(host, row, token.as_deref(), cloid, 0, None, report::OUTCOME_NO_POSITION);
        }
    };
    let size = round_size(c.size.map_or(pos_size, |s| s.min(pos_size)), asset.sz_decimals);
    if size.is_zero() {
        return ctx.finalize(host, row, token.as_deref(), cloid, 0, None, report::OUTCOME_NO_POSITION);
    }
    let is_buy = crate::trigger::close_is_buy(c.is_long);
    let bps = o.slippage_bps as u128;
    let (raw_px, dir) = if is_buy {
        (mark.mul_ratio(10_000 + bps, 10_000, Rounding::Up), Rounding::Up)
    } else {
        (mark.mul_ratio(10_000 - bps, 10_000, Rounding::Down), Rounding::Down)
    };
    let px = round_perp_px(raw_px, asset.sz_decimals, dir);
    if px.is_zero() {
        return Err(format!("order {}: close price rounds to zero", row.id));
    }

    // Claim the attempt before anything leaves the enclave.
    let sending = serde_json::to_vec(&FireRecord::Sending { attempt, cloid: hex::encode(cloid) }).unwrap();
    if !kv_put(host, &fire_name, token.as_deref(), &sending)? {
        ctx.stats.pending += 1; // another tick holds it
        return Ok(());
    }
    let sending_token = host.kv_get(&fire_name)?.ok_or("fire record vanished")?.token;

    let action = api::close_order_action(&CloseOrder { asset: asset.index, is_buy, px, sz: size, cloid });
    let nonce = next_nonce(host)?;
    let sig = signing::sign_l1_action(&mut HostAgent(host), &action, nonce, None, c.is_mainnet)?;
    ctx.stats.sent += 1;
    let answer = post_json(host, &format!("{base}/exchange"), &api::exchange_body(&action, nonce, &sig));
    match answer.and_then(|b| api::parse_order_response(&b)) {
        Ok(OrderResult::Filled { oid, total_sz, avg_px }) => {
            ctx.finalize(host, row, Some(&sending_token), cloid, oid, Some((total_sz, avg_px)), report::OUTCOME_FILLED)
        }
        Ok(OrderResult::Rejected(_)) | Ok(OrderResult::Resting { .. }) => {
            // Hyperliquid's message can name the asset; it stays inside the enclave.
            ctx.stats.errors.push(format!("order {}: close not filled (attempt {attempt}/{})", row.id, ctx.cfg.max_attempts));
            after_failure(ctx, host, row, attempt, cloid, &sending_token).map(|_| ())
        }
        Err(_) => {
            // Unknown whether it landed: leave `sending`; the next tick asks by cloid.
            ctx.stats.pending += 1;
            ctx.stats.errors.push(format!("order {}: exchange answer unreadable, will reconcile", row.id));
            Ok(())
        }
    }
}

pub fn tick(host: &mut dyn Host, cfg: &Config) -> Result<TickOutput, String> {
    let now = host.now_ms();
    let (height, active) = read_active(host, cfg)?;
    let seal_secret = seal::secret_from_seed(host.seal_seed()?);
    let mut ctx = Ctx { cfg, now, stats: Stats { orders_seen: active.len() as u32, ..Default::default() }, reports: vec![] };

    // Rotate through the active set when it is larger than one tick's budget.
    let batch: Vec<&ActiveOrder> = if active.len() <= cfg.max_orders_per_tick {
        active.iter().collect()
    } else {
        let cur = host.kv_get("cursor")?;
        let start = cur.as_ref().and_then(|r| r.value.as_slice().try_into().ok()).map(u64::from_be_bytes).unwrap_or(0) as usize
            % active.len();
        let next = ((start + cfg.max_orders_per_tick) % active.len()) as u64;
        kv_put(host, "cursor", cur.as_ref().map(|r| r.token.as_slice()), &next.to_be_bytes())?;
        active.iter().cycle().skip(start).take(cfg.max_orders_per_tick).collect()
    };

    let mut opened: Vec<(&ActiveOrder, SealedOrderV1, CheckedOrder)> = Vec::new();
    for row in batch {
        ctx.stats.processed += 1;
        match open_order(&seal_secret, &cfg.contract_id, row) {
            Ok((o, c)) => opened.push((row, o, c)),
            Err(_) => {
                ctx.stats.invalid += 1;
                let name = format!("fire:{}", row.id);
                let existing: Option<(FireRecord, Vec<u8>)> = kv_json(host, &name)?;
                match existing {
                    Some((FireRecord::Final { report, sig }, _)) => {
                        ctx.reports.push(SignedReport { kind: 0, order_id: Some(row.id.to_string()), report, sig });
                        ctx.stats.reports += 1;
                    }
                    other => {
                        let token = other.map(|(_, t)| t);
                        ctx.finalize(host, row, token.as_deref(), [0u8; 16], 0, None, report::OUTCOME_INVALID)?;
                    }
                }
            }
        }
    }

    // One meta fetch per network that has work.
    let mut metas: BTreeMap<bool, Result<HashMap<String, Asset>, String>> = BTreeMap::new();
    for (_, _, c) in &opened {
        if !metas.contains_key(&c.is_mainnet) {
            let base = api::api_base(c.is_mainnet);
            let m = post_json(host, &format!("{base}/info"), &api::meta_request()).and_then(|b| api::parse_meta(&b));
            metas.insert(c.is_mainnet, m);
        }
    }
    for (net, m) in &metas {
        if m.is_err() {
            ctx.stats.errors.push(format!("hyperliquid {} meta unavailable; its orders wait", if *net { "mainnet" } else { "testnet" }));
        }
    }

    for (row, o, c) in &opened {
        let meta = match metas.get(&c.is_mainnet) {
            Some(Ok(m)) => m,
            _ => continue,
        };
        let asset = match meta.get(&o.coin) {
            Some(a) => a.clone(),
            None => {
                ctx.stats.invalid += 1;
                ctx.finalize(host, row, None, [0u8; 16], 0, None, report::OUTCOME_INVALID)?;
                continue;
            }
        };
        if let Err(e) = process_order(&mut ctx, host, row, o, c, &asset) {
            // Errors are about transport and storage; they never carry the order's contents.
            ctx.stats.errors.push(format!("order {}: {}", row.id, sanitize(&e)));
        }
    }

    let hb = HeartbeatV1 { contract_id: cfg.contract_id.clone(), tick_ms: now, orders_seen: active.len() as u32, code_hash: [0u8; 32] };
    let heartbeat = sign_report(host, ReportKind::Heartbeat, borsh::to_vec(&hb).map_err(|e| e.to_string())?, None)?;
    Ok(TickOutput { ok: true, contract_id: cfg.contract_id.clone(), block_height: height, reports: ctx.reports, heartbeat, stats: ctx.stats })
}

/// Keep error text to a short, content-free description.
fn sanitize(e: &str) -> String {
    let first = e.split(['{', '[', '"']).next().unwrap_or("error").trim();
    let mut s: String = first.chars().take(120).collect();
    if s.is_empty() {
        s = "error".into();
    }
    s
}

#[derive(Serialize, Debug)]
pub struct PubKeys {
    pub contract_id: String,
    pub x25519: String,
    pub ed25519: String,
    pub agent_address: String,
}

pub fn pubkeys(host: &mut dyn Host, cfg: &Config) -> Result<PubKeys, String> {
    let x = seal::public_of(&seal::secret_from_seed(host.seal_seed()?));
    let ed = host.report_public_key()?;
    let agent = signing::address_from_pubkey64(&host.agent_public_key()?);
    Ok(PubKeys {
        contract_id: cfg.contract_id.clone(),
        x25519: hex::encode(x),
        ed25519: hex::encode(ed),
        agent_address: signing::address_hex(&agent),
    })
}

pub const SELFTEST_MESSAGE: &[u8] = b"blindstop:v1:selftest";

/// Entry point shared by the OutLayer component and the harness: JSON in, JSON out.
/// Only `op` is read from the input.
pub fn run(host: &mut dyn Host, cfg: &Config, input: &[u8]) -> serde_json::Value {
    #[derive(Deserialize)]
    struct Input {
        op: String,
    }
    let op = match serde_json::from_slice::<Input>(input) {
        Ok(i) => i.op,
        Err(_) => return serde_json::json!({ "ok": false, "error": "input must be {\"op\": \"pubkeys\" | \"tick\" | \"selftest\"}" }),
    };
    let result = match op.as_str() {
        "pubkeys" => pubkeys(host, cfg).map(|p| serde_json::json!({ "ok": true, "pubkeys": p })),
        "selftest" => host.report_sign(SELFTEST_MESSAGE).and_then(|sig| {
            Ok(serde_json::json!({
                "ok": true,
                "message": String::from_utf8_lossy(SELFTEST_MESSAGE),
                "ed25519": hex::encode(host.report_public_key()?),
                "signature": hex::encode(sig),
            }))
        }),
        "tick" => tick(host, cfg).map(|t| serde_json::to_value(t).expect("tick output serializes")),
        _ => Err(format!("unknown op {op:?}")),
    };
    result.unwrap_or_else(|e| serde_json::json!({ "ok": false, "error": sanitize(&e) }))
}
