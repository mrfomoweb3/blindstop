//! Reading the Blindstop contract over NEAR JSON-RPC. Two independent providers are asked
//! for the same finalized block; their answers must be byte-identical or the tick refuses.

use base64::Engine;
use serde::Deserialize;
use serde_json::Value as Json;

pub const PAGE_SIZE: u32 = 100;
pub const MAX_PAGES: u32 = 10;

pub fn final_block_request() -> Json {
    serde_json::json!({ "jsonrpc": "2.0", "id": "blindstop", "method": "block", "params": { "finality": "final" } })
}

pub fn parse_block_height(body: &str) -> Result<u64, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("block: not json: {e}"))?;
    if let Some(e) = v.get("error") {
        return Err(format!("block: rpc error {}", e));
    }
    v.pointer("/result/header/height").and_then(Json::as_u64).ok_or_else(|| "block: no height".to_string())
}

pub fn view_request(contract_id: &str, method: &str, args: &Json, block_height: u64) -> Json {
    let args_b64 = base64::engine::general_purpose::STANDARD.encode(args.to_string());
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": "blindstop",
        "method": "query",
        "params": {
            "request_type": "call_function",
            "block_id": block_height,
            "account_id": contract_id,
            "method_name": method,
            "args_base64": args_b64,
        }
    })
}

/// The raw bytes a view function returned.
pub fn parse_view_result(body: &str) -> Result<Vec<u8>, String> {
    let v: Json = serde_json::from_str(body).map_err(|e| format!("query: not json: {e}"))?;
    if let Some(e) = v.get("error") {
        return Err(format!("query: rpc error {}", e));
    }
    if let Some(e) = v.pointer("/result/error") {
        return Err(format!("query: contract error {}", e));
    }
    let arr = v.pointer("/result/result").and_then(Json::as_array).ok_or("query: no result bytes")?;
    arr.iter()
        .map(|b| b.as_u64().filter(|n| *n <= 255).map(|n| n as u8).ok_or_else(|| "query: result is not bytes".to_string()))
        .collect()
}

/// One row of `get_active`, as the contract returns it.
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ActiveOrderRow {
    /// u64 as a decimal string (NEAR `U64`).
    pub id: String,
    pub owner: String,
    /// standard base64
    pub ciphertext: String,
    /// lowercase hex, 32 bytes
    pub commitment: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveOrder {
    pub id: u64,
    pub owner: String,
    pub ciphertext: Vec<u8>,
    pub commitment: [u8; 32],
}

impl ActiveOrderRow {
    pub fn decode(&self) -> Result<ActiveOrder, String> {
        let id: u64 = self.id.parse().map_err(|_| "row: bad id")?;
        let ciphertext = base64::engine::general_purpose::STANDARD.decode(&self.ciphertext).map_err(|_| "row: bad ciphertext")?;
        let c = hex::decode(&self.commitment).map_err(|_| "row: bad commitment")?;
        let commitment: [u8; 32] = c.try_into().map_err(|_| "row: commitment is not 32 bytes")?;
        Ok(ActiveOrder { id, owner: self.owner.clone(), ciphertext, commitment })
    }
}

pub fn get_active_args(from_index: u32, limit: u32) -> Json {
    serde_json::json!({ "from_index": from_index, "limit": limit })
}
