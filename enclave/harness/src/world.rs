//! The outside world the enclave talks to, faked faithfully enough to run the real wasm:
//!
//! * two NEAR RPC providers serving `block` and `get_active` from an in-memory order book
//!   (provider B can be told to lie, to test the disagreement refusal);
//! * Hyperliquid `/info` (`metaAndAssetCtxs` from a recorded testnet snapshot, positions,
//!   `orderStatus`, `userFills`) and `/exchange`, which recovers the signer of every order and
//!   refuses anything that is not a reduce-only IOC from the approved agent.

use base64::Engine;
use blindstop_core::decimal::Dec;
use blindstop_core::hl::msgpack::Value as Msg;
use blindstop_core::hl::signing::{self, HlSignature};
use serde_json::{json, Value as Json};
use std::collections::{BTreeMap, HashMap};

pub const RPC_A: &str = "https://rpc.testnet.fastnear.com";
pub const RPC_B: &str = "https://near-testnet.drpc.org";
pub const HL_TESTNET: &str = "https://api.hyperliquid-testnet.xyz";

#[derive(Clone, Debug)]
pub struct Row {
    pub id: u64,
    pub owner: String,
    pub ciphertext: Vec<u8>,
    pub commitment: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExchangeMode {
    Fill,
    Reject,
    /// Apply the fill, then lose the answer (HTTP 502): tests reconciliation by cloid.
    FillThenDrop,
}

#[derive(Clone, Debug)]
pub struct ExchangeCall {
    pub user: String,
    pub asset: u64,
    pub is_buy: bool,
    pub px: String,
    pub sz: String,
    pub cloid: String,
    pub nonce: u64,
    pub signer: String,
}

#[derive(Clone, Debug)]
struct Landed {
    oid: u64,
    user: String,
    status: &'static str,
}

pub struct World {
    pub contract_id: String,
    pub height: u64,
    pub orders: BTreeMap<u64, Row>,
    pub rpc_b_lies: bool,
    meta: Json,
    pub marks: HashMap<String, String>,
    /// user (lowercase 0x hex) → coin → signed size
    pub positions: HashMap<String, HashMap<String, String>>,
    pub approved_agent: Option<String>,
    pub exchange_mode: ExchangeMode,
    pub exchange_calls: Vec<ExchangeCall>,
    landed: HashMap<String, Landed>,
    fills: Vec<Json>,
    next_oid: u64,
    /// Every URL the enclave reached, in order.
    pub requests: Vec<String>,
}

impl World {
    pub fn new(contract_id: &str) -> World {
        World {
            contract_id: contract_id.into(),
            height: 200_000_000,
            orders: BTreeMap::new(),
            rpc_b_lies: false,
            meta: serde_json::from_str(include_str!("../fixtures/testnet_meta.json")).expect("fixture"),
            marks: HashMap::new(),
            positions: HashMap::new(),
            approved_agent: None,
            exchange_mode: ExchangeMode::Fill,
            exchange_calls: vec![],
            landed: HashMap::new(),
            fills: vec![],
            next_oid: 1_000_000,
            requests: vec![],
        }
    }

    pub fn mark_of(&self, coin: &str) -> String {
        if let Some(m) = self.marks.get(coin) {
            return m.clone();
        }
        let i = self.asset_index(coin).expect("coin in fixture");
        self.meta[1][i]["markPx"].as_str().unwrap().to_string()
    }

    pub fn asset_index(&self, coin: &str) -> Option<usize> {
        self.meta[0]["universe"].as_array().unwrap().iter().position(|u| u["name"] == coin)
    }

    pub fn sz_decimals(&self, coin: &str) -> u32 {
        self.meta[0]["universe"][self.asset_index(coin).unwrap()]["szDecimals"].as_u64().unwrap() as u32
    }

    fn coin_of(&self, asset: u64) -> String {
        self.meta[0]["universe"][asset as usize]["name"].as_str().unwrap().to_string()
    }

    pub fn set_position(&mut self, user: &str, coin: &str, szi: &str) {
        self.positions.entry(user.to_lowercase()).or_default().insert(coin.into(), szi.into());
    }

    pub fn position(&self, user: &str, coin: &str) -> Option<String> {
        self.positions.get(&user.to_lowercase()).and_then(|m| m.get(coin)).cloned()
    }

    pub fn exchange_count(&self) -> usize {
        self.exchange_calls.len()
    }

    /// Route one HTTPS POST. Returns (status, body).
    pub fn handle(&mut self, url: &str, body: &str) -> (u16, String) {
        self.requests.push(url.to_string());
        let req: Json = match serde_json::from_str(body) {
            Ok(v) => v,
            Err(_) => return (400, "bad json".into()),
        };
        if url == RPC_A || url == RPC_B {
            return self.near(url == RPC_B, &req);
        }
        match url.strip_prefix(HL_TESTNET) {
            Some("/info") => self.info(&req),
            Some("/exchange") => self.exchange(&req),
            _ => (404, format!("harness: no route for {url}")),
        }
    }

    fn near(&self, is_b: bool, req: &Json) -> (u16, String) {
        match req["method"].as_str() {
            Some("block") => (200, json!({"jsonrpc":"2.0","id":"blindstop","result":{"header":{"height": self.height}}}).to_string()),
            Some("query") => {
                let p = &req["params"];
                assert_eq!(p["request_type"], "call_function");
                assert_eq!(p["block_id"].as_u64(), Some(self.height), "enclave must read at one fixed height");
                if p["account_id"] != self.contract_id.as_str() {
                    return (200, json!({"jsonrpc":"2.0","id":"blindstop","result":{"error":"wrong contract"}}).to_string());
                }
                assert_eq!(p["method_name"], "get_active");
                let args: Json = serde_json::from_slice(
                    &base64::engine::general_purpose::STANDARD.decode(p["args_base64"].as_str().unwrap()).unwrap(),
                )
                .unwrap();
                let from = args["from_index"].as_u64().unwrap_or(0) as usize;
                let limit = args["limit"].as_u64().unwrap_or(100) as usize;
                let mut rows: Vec<Json> = self
                    .orders
                    .values()
                    .skip(from)
                    .take(limit)
                    .map(|r| {
                        json!({
                            "id": r.id.to_string(),
                            "owner": r.owner,
                            "ciphertext": base64::engine::general_purpose::STANDARD.encode(&r.ciphertext),
                            "commitment": hex::encode(r.commitment),
                        })
                    })
                    .collect();
                if is_b && self.rpc_b_lies && !rows.is_empty() {
                    rows.pop(); // hide an order
                }
                let bytes: Vec<u8> = serde_json::to_vec(&rows).unwrap();
                (200, json!({"jsonrpc":"2.0","id":"blindstop","result":{"result": bytes, "logs": [], "block_height": self.height}}).to_string())
            }
            _ => (200, json!({"jsonrpc":"2.0","id":"blindstop","error":{"name":"METHOD_NOT_FOUND"}}).to_string()),
        }
    }

    fn info(&self, req: &Json) -> (u16, String) {
        match req["type"].as_str() {
            Some("metaAndAssetCtxs") => {
                let mut meta = self.meta.clone();
                for (coin, px) in &self.marks {
                    if let Some(i) = self.asset_index(coin) {
                        meta[1][i]["markPx"] = Json::String(px.clone());
                    }
                }
                (200, meta.to_string())
            }
            Some("clearinghouseState") => {
                let user = req["user"].as_str().unwrap().to_lowercase();
                let positions: Vec<Json> = self
                    .positions
                    .get(&user)
                    .map(|m| {
                        m.iter()
                            .filter(|(_, szi)| Dec::parse_signed(szi).map(|(_, d)| !d.is_zero()).unwrap_or(false))
                            .map(|(coin, szi)| json!({"type":"oneWay","position":{"coin": coin, "szi": szi}}))
                            .collect()
                    })
                    .unwrap_or_default();
                (200, json!({"assetPositions": positions, "withdrawable": "0"}).to_string())
            }
            Some("orderStatus") => {
                let cloid = req["oid"].as_str().unwrap().to_lowercase();
                match self.landed.get(&cloid) {
                    Some(l) if Some(l.user.as_str()) == req["user"].as_str().map(str::to_lowercase).as_deref() => (
                        200,
                        json!({"status":"order","order":{"order":{"oid": l.oid},"status": l.status,"statusTimestamp": 1}}).to_string(),
                    ),
                    _ => (200, json!({"status":"unknownOid"}).to_string()),
                }
            }
            Some("userFills") => {
                let user = req["user"].as_str().unwrap().to_lowercase();
                let f: Vec<&Json> = self.fills.iter().filter(|f| f["user"] == user.as_str()).collect();
                (200, serde_json::to_string(&f).unwrap())
            }
            other => (422, format!("harness: unsupported info type {other:?}")),
        }
    }

    fn exchange(&mut self, req: &Json) -> (u16, String) {
        let action = &req["action"];
        let nonce = req["nonce"].as_u64().expect("nonce");
        let sig = HlSignature {
            r: hex32(req["signature"]["r"].as_str().unwrap()),
            s: hex32(req["signature"]["s"].as_str().unwrap()),
            v: req["signature"]["v"].as_u64().unwrap() as u8,
        };
        // The connectionId is over msgpack of the action exactly as sent (key order preserved).
        let signer = match signing::recover_l1_signer(&json_to_msg(action), nonce, &sig, false) {
            Ok(a) => signing::address_hex(&a),
            Err(e) => return (200, json!({"status":"err","response": format!("bad signature: {e}")}).to_string()),
        };
        if Some(&signer) != self.approved_agent.as_ref() {
            return (200, json!({"status":"err","response": format!("User or API Wallet {signer} does not exist.")}).to_string());
        }
        assert_eq!(action["type"], "order");
        assert_eq!(action["grouping"], "na");
        let o = &action["orders"][0];
        assert_eq!(o["r"], true, "close must be reduce-only");
        assert_eq!(o["t"]["limit"]["tif"], "Ioc", "close must be IOC");
        let cloid = o["c"].as_str().unwrap().to_lowercase();
        let asset = o["a"].as_u64().unwrap();
        let coin = self.coin_of(asset);
        let is_buy = o["b"].as_bool().unwrap();
        let px = o["p"].as_str().unwrap().to_string();
        let sz = o["s"].as_str().unwrap().to_string();
        // The agent acts for the account named in the enclave; the harness pins it to whoever
        // holds the position (one test wallet), as Hyperliquid resolves agent → user.
        let user = self
            .positions
            .iter()
            .find(|(_, m)| m.contains_key(&coin))
            .map(|(u, _)| u.clone())
            .unwrap_or_default();
        self.exchange_calls.push(ExchangeCall { user: user.clone(), asset, is_buy, px: px.clone(), sz: sz.clone(), cloid: cloid.clone(), nonce, signer });

        if self.exchange_mode == ExchangeMode::Reject {
            return (
                200,
                json!({"status":"ok","response":{"type":"order","data":{"statuses":[{"error": format!("Order could not immediately match against any resting orders. asset={asset}")}]}}})
                    .to_string(),
            );
        }
        // Fill at the mark (inside the slippage bound by construction), reduce the position.
        let mark = self.mark_of(&coin);
        let oid = self.next_oid;
        self.next_oid += 1;
        if let Some(cur) = self.position(&user, &coin) {
            let (neg, mag) = Dec::parse_signed(&cur).unwrap();
            let fill = Dec::parse(&sz).unwrap().min(mag);
            let left = Dec::from_units(mag.units() - fill.units());
            let left_s = if left.is_zero() { "0".to_string() } else if neg { format!("-{}", left.to_wire()) } else { left.to_wire() };
            self.set_position(&user, &coin, &left_s);
        }
        self.landed.insert(cloid.clone(), Landed { oid, user: user.clone(), status: "filled" });
        self.fills.push(json!({"user": user, "coin": coin, "oid": oid, "px": mark, "sz": sz, "side": if is_buy {"B"} else {"A"}}));
        if self.exchange_mode == ExchangeMode::FillThenDrop {
            return (502, "bad gateway".into());
        }
        (
            200,
            json!({"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz": sz, "avgPx": mark, "oid": oid}}]}}}).to_string(),
        )
    }
}

fn hex32(s: &str) -> [u8; 32] {
    hex::decode(s.trim_start_matches("0x")).unwrap().try_into().unwrap()
}

/// JSON (insertion-ordered) → msgpack value, as Hyperliquid re-encodes what it receives.
pub fn json_to_msg(v: &Json) -> Msg {
    match v {
        Json::Null => Msg::Nil,
        Json::Bool(b) => Msg::Bool(*b),
        Json::Number(n) => Msg::UInt(n.as_u64().expect("only unsigned integers in actions")),
        Json::String(s) => Msg::Str(s.clone()),
        Json::Array(a) => Msg::Array(a.iter().map(json_to_msg).collect()),
        Json::Object(o) => Msg::Map(o.iter().map(|(k, v)| (k.clone(), json_to_msg(v))).collect()),
    }
}
