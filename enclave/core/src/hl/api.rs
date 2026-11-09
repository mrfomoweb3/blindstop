//! Hyperliquid request bodies and response parsing (`/info` and `/exchange`).

use super::msgpack::Value;
use super::signing::HlSignature;
use crate::decimal::{Dec, Rounding};
use serde_json::Value as Json;
use std::collections::HashMap;

pub const MAINNET_API: &str = "https://api.hyperliquid.xyz";
pub const TESTNET_API: &str = "https://api.hyperliquid-testnet.xyz";

pub fn api_base(is_mainnet: bool) -> &'static str {
    if is_mainnet {
        MAINNET_API
    } else {
        TESTNET_API
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asset {
    pub index: u32,
    pub sz_decimals: u32,
    pub mark: Option<Dec>,
}

pub fn meta_request() -> Json {
    serde_json::json!({ "type": "metaAndAssetCtxs" })
}

/// `metaAndAssetCtxs` → coin name → (asset index, szDecimals, markPx). Delisted coins and
/// coins without a mark are kept with `mark: None`, which never triggers.
pub fn parse_meta(body: &str) -> Result<HashMap<String, Asset>, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("meta is not json: {e}"))?;
    let arr = v.as_array().ok_or("meta: expected [meta, ctxs]")?;
    if arr.len() != 2 {
        return Err("meta: expected [meta, ctxs]".into());
    }
    let universe = arr[0].get("universe").and_then(Json::as_array).ok_or("meta: no universe")?;
    let ctxs = arr[1].as_array().ok_or("meta: no asset contexts")?;
    if universe.len() != ctxs.len() {
        return Err("meta: universe and contexts differ in length".into());
    }
    let mut out = HashMap::with_capacity(universe.len());
    for (i, (u, c)) in universe.iter().zip(ctxs).enumerate() {
        let name = u.get("name").and_then(Json::as_str).ok_or("meta: asset without name")?;
        let sz_decimals = u.get("szDecimals").and_then(Json::as_u64).ok_or("meta: asset without szDecimals")? as u32;
        let delisted = u.get("isDelisted").and_then(Json::as_bool).unwrap_or(false);
        let mark = if delisted {
            None
        } else {
            c.get("markPx").and_then(Json::as_str).and_then(|s| Dec::parse(s).ok())
        };
        out.insert(name.to_string(), Asset { index: i as u32, sz_decimals, mark });
    }
    Ok(out)
}

pub fn clearinghouse_request(user: &str) -> Json {
    serde_json::json!({ "type": "clearinghouseState", "user": user })
}

/// Signed position size (`szi`) on `coin`: `Some((is_long, |szi|))`, or `None` when flat.
pub fn parse_position(body: &str, coin: &str) -> Result<Option<(bool, Dec)>, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("clearinghouseState is not json: {e}"))?;
    let positions = v.get("assetPositions").and_then(Json::as_array).ok_or("clearinghouseState: no assetPositions")?;
    for p in positions {
        let pos = match p.get("position") {
            Some(pos) => pos,
            None => continue,
        };
        if pos.get("coin").and_then(Json::as_str) != Some(coin) {
            continue;
        }
        let szi = pos.get("szi").and_then(Json::as_str).ok_or("position without szi")?;
        let (neg, mag) = Dec::parse_signed(szi).map_err(|e| e.to_string())?;
        if mag.is_zero() {
            return Ok(None);
        }
        return Ok(Some((!neg, mag)));
    }
    Ok(None)
}

pub fn order_status_request(user: &str, cloid: &[u8; 16]) -> Json {
    serde_json::json!({ "type": "orderStatus", "user": user, "oid": format!("0x{}", hex::encode(cloid)) })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KnownStatus {
    /// Hyperliquid has never seen this cloid: the earlier attempt did not land.
    Unknown,
    /// Landed and finished filling; `oid` to look fills up by.
    Filled { oid: u64 },
    /// Landed and is not resting or filled (IOC cancelled, rejected, margin cancelled…).
    Dead { oid: u64, status: String },
    /// Partially filled IOC also ends as cancelled with fills; caller checks fills by oid.
    Open { oid: u64 },
}

pub fn parse_order_status(body: &str) -> Result<KnownStatus, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("orderStatus is not json: {e}"))?;
    match v.get("status").and_then(Json::as_str) {
        Some("unknownOid") => Ok(KnownStatus::Unknown),
        Some("order") => {
            let o = v.get("order").ok_or("orderStatus: no order")?;
            let oid = o.get("order").and_then(|x| x.get("oid")).and_then(Json::as_u64).ok_or("orderStatus: no oid")?;
            let status = o.get("status").and_then(Json::as_str).ok_or("orderStatus: no status")?;
            Ok(match status {
                "filled" => KnownStatus::Filled { oid },
                "open" | "triggered" => KnownStatus::Open { oid },
                other => KnownStatus::Dead { oid, status: other.to_string() },
            })
        }
        _ => Err(format!("orderStatus: unexpected answer {}", truncate(body))),
    }
}

pub fn user_fills_request(user: &str) -> Json {
    serde_json::json!({ "type": "userFills", "user": user })
}

/// Total size and size-weighted average price of every fill of `oid`. `None` if no fills.
pub fn fills_for_oid(body: &str, oid: u64) -> Result<Option<(Dec, Dec)>, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("userFills is not json: {e}"))?;
    let fills = v.as_array().ok_or("userFills: expected an array")?;
    let mut total_sz: u128 = 0;
    let mut notional: u128 = 0; // Σ px_units × sz_units
    for f in fills {
        if f.get("oid").and_then(Json::as_u64) != Some(oid) {
            continue;
        }
        let px = Dec::parse(f.get("px").and_then(Json::as_str).ok_or("fill without px")?).map_err(|e| e.to_string())?;
        let sz = Dec::parse(f.get("sz").and_then(Json::as_str).ok_or("fill without sz")?).map_err(|e| e.to_string())?;
        total_sz += sz.units();
        notional = notional.checked_add(px.units().checked_mul(sz.units()).ok_or("fill overflow")?).ok_or("fill overflow")?;
    }
    if total_sz == 0 {
        return Ok(None);
    }
    let avg = Dec::from_units(notional / total_sz).round_to(6, Rounding::Down);
    Ok(Some((Dec::from_units(total_sz), avg)))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloseOrder {
    pub asset: u32,
    pub is_buy: bool,
    pub px: Dec,
    pub sz: Dec,
    pub cloid: [u8; 16],
}

/// The order action exactly as `Exchange.bulk_orders` builds it for one reduce-only IOC:
/// `{type, orders: [{a, b, p, s, r, t: {limit: {tif}}, c}], grouping: "na"}`.
pub fn close_order_action(o: &CloseOrder) -> Value {
    Value::map(vec![
        ("type", Value::str("order")),
        (
            "orders",
            Value::Array(vec![Value::map(vec![
                ("a", Value::UInt(o.asset as u64)),
                ("b", Value::Bool(o.is_buy)),
                ("p", Value::str(o.px.to_wire())),
                ("s", Value::str(o.sz.to_wire())),
                ("r", Value::Bool(true)),
                ("t", Value::map(vec![("limit", Value::map(vec![("tif", Value::str("Ioc"))]))])),
                ("c", Value::str(format!("0x{}", hex::encode(o.cloid)))),
            ])]),
        ),
        ("grouping", Value::str("na")),
    ])
}

pub fn exchange_body(action: &Value, nonce: u64, sig: &HlSignature) -> Json {
    serde_json::json!({
        "action": action.to_json(),
        "nonce": nonce,
        "signature": sig.to_json(),
        "vaultAddress": Json::Null,
        "expiresAfter": Json::Null,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrderResult {
    Filled { oid: u64, total_sz: Dec, avg_px: Dec },
    /// IOC cannot rest; treated as a failed attempt if it ever appears.
    Resting { oid: u64 },
    /// Hyperliquid said no: e.g. no liquidity within the slippage bound, agent not approved.
    Rejected(String),
}

pub fn parse_order_response(body: &str) -> Result<OrderResult, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("exchange answer is not json: {e}"))?;
    match v.get("status").and_then(Json::as_str) {
        Some("ok") => {}
        Some("err") => {
            let msg = v.get("response").map(|r| r.as_str().map(str::to_string).unwrap_or_else(|| r.to_string()));
            return Ok(OrderResult::Rejected(msg.unwrap_or_else(|| "error".into())));
        }
        _ => return Err(format!("exchange: unexpected answer {}", truncate(body))),
    }
    let statuses = v
        .pointer("/response/data/statuses")
        .and_then(Json::as_array)
        .ok_or_else(|| format!("exchange: no statuses in {}", truncate(body)))?;
    let s = statuses.first().ok_or("exchange: empty statuses")?;
    if let Some(f) = s.get("filled") {
        let oid = f.get("oid").and_then(Json::as_u64).ok_or("filled without oid")?;
        let total_sz = Dec::parse(f.get("totalSz").and_then(Json::as_str).ok_or("filled without totalSz")?).map_err(|e| e.to_string())?;
        let avg_px = Dec::parse(f.get("avgPx").and_then(Json::as_str).ok_or("filled without avgPx")?).map_err(|e| e.to_string())?;
        return Ok(OrderResult::Filled { oid, total_sz, avg_px });
    }
    if let Some(r) = s.get("resting") {
        let oid = r.get("oid").and_then(Json::as_u64).ok_or("resting without oid")?;
        return Ok(OrderResult::Resting { oid });
    }
    if let Some(e) = s.get("error") {
        return Ok(OrderResult::Rejected(e.as_str().unwrap_or("error").to_string()));
    }
    Err(format!("exchange: unknown status {}", truncate(&s.to_string())))
}

fn truncate(s: &str) -> String {
    if s.len() > 200 {
        format!("{}…", &s[..200])
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meta_parses_live_shape() {
        let body = r#"[{"universe":[{"szDecimals":2,"name":"SOL","maxLeverage":10},{"szDecimals":5,"name":"BTC","maxLeverage":40},{"szDecimals":0,"name":"OLD","maxLeverage":3,"isDelisted":true}]},
            [{"markPx":"86.615","oraclePx":"86.655"},{"markPx":"75191.0"},{"markPx":"1.0"}]]"#;
        let m = parse_meta(body).unwrap();
        assert_eq!(m["BTC"], Asset { index: 1, sz_decimals: 5, mark: Some(Dec::parse("75191").unwrap()) });
        assert_eq!(m["SOL"].index, 0);
        assert_eq!(m["OLD"].mark, None);
    }

    #[test]
    fn positions() {
        let body = r#"{"assetPositions":[{"position":{"coin":"ETH","szi":"-0.5"},"type":"oneWay"},{"position":{"coin":"BTC","szi":"0.01"},"type":"oneWay"}]}"#;
        assert_eq!(parse_position(body, "BTC").unwrap(), Some((true, Dec::parse("0.01").unwrap())));
        assert_eq!(parse_position(body, "ETH").unwrap(), Some((false, Dec::parse("0.5").unwrap())));
        assert_eq!(parse_position(body, "SOL").unwrap(), None);
    }

    #[test]
    fn order_responses() {
        let filled = r#"{"status":"ok","response":{"type":"order","data":{"statuses":[{"filled":{"totalSz":"0.02","avgPx":"1891.4","oid":77738308}}]}}}"#;
        assert_eq!(
            parse_order_response(filled).unwrap(),
            OrderResult::Filled { oid: 77738308, total_sz: Dec::parse("0.02").unwrap(), avg_px: Dec::parse("1891.4").unwrap() }
        );
        let rejected = r#"{"status":"ok","response":{"type":"order","data":{"statuses":[{"error":"Order could not immediately match against any resting orders."}]}}}"#;
        assert!(matches!(parse_order_response(rejected).unwrap(), OrderResult::Rejected(_)));
        let err = r#"{"status":"err","response":"User or API Wallet 0xabc does not exist."}"#;
        assert_eq!(parse_order_response(err).unwrap(), OrderResult::Rejected("User or API Wallet 0xabc does not exist.".into()));
        assert!(parse_order_response("<html>").is_err());
    }

    #[test]
    fn order_status() {
        assert_eq!(parse_order_status(r#"{"status":"unknownOid"}"#).unwrap(), KnownStatus::Unknown);
        let f = r#"{"status":"order","order":{"order":{"coin":"BTC","oid":42},"status":"filled","statusTimestamp":1}}"#;
        assert_eq!(parse_order_status(f).unwrap(), KnownStatus::Filled { oid: 42 });
        let c = r#"{"status":"order","order":{"order":{"oid":43},"status":"canceled","statusTimestamp":1}}"#;
        assert_eq!(parse_order_status(c).unwrap(), KnownStatus::Dead { oid: 43, status: "canceled".into() });
    }

    #[test]
    fn fills_average() {
        let body = r#"[{"oid":5,"px":"100","sz":"1"},{"oid":5,"px":"103","sz":"2"},{"oid":6,"px":"1","sz":"9"}]"#;
        let (sz, avg) = fills_for_oid(body, 5).unwrap().unwrap();
        assert_eq!(sz.to_wire(), "3");
        assert_eq!(avg.to_wire(), "102");
        assert_eq!(fills_for_oid(body, 7).unwrap(), None);
    }

    #[test]
    fn action_shape() {
        let a = close_order_action(&CloseOrder {
            asset: 3,
            is_buy: false,
            px: Dec::parse("74439").unwrap(),
            sz: Dec::parse("0.001").unwrap(),
            cloid: [0xab; 16],
        });
        assert_eq!(
            a.to_json().to_string(),
            r#"{"type":"order","orders":[{"a":3,"b":false,"p":"74439","s":"0.001","r":true,"t":{"limit":{"tif":"Ioc"}},"c":"0xabababababababababababababababab"}],"grouping":"na"}"#
        );
    }
}
