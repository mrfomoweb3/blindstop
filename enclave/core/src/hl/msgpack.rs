//! A minimal MessagePack encoder with exactly the encodings Python's `msgpack.packb` picks
//! (msgpack ≥ 1.0, `use_bin_type=True`): smallest unsigned int form, str8 for 32..=255 byte
//! strings, maps in insertion order. Hyperliquid hashes `packb(action)`, so key order and
//! integer widths must match the SDK byte for byte.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Nil,
    Bool(bool),
    UInt(u64),
    Str(String),
    Array(Vec<Value>),
    /// Insertion-ordered.
    Map(Vec<(String, Value)>),
}

impl Value {
    pub fn str(s: impl Into<String>) -> Value {
        Value::Str(s.into())
    }

    pub fn map(entries: Vec<(&str, Value)>) -> Value {
        Value::Map(entries.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        encode_into(self, &mut out);
        out
    }

    /// JSON with the same key order (for the `/exchange` body and for logging).
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Value::Nil => serde_json::Value::Null,
            Value::Bool(b) => serde_json::Value::Bool(*b),
            Value::UInt(n) => serde_json::Value::from(*n),
            Value::Str(s) => serde_json::Value::String(s.clone()),
            Value::Array(a) => serde_json::Value::Array(a.iter().map(Value::to_json).collect()),
            Value::Map(m) => {
                let mut obj = serde_json::Map::new();
                for (k, v) in m {
                    obj.insert(k.clone(), v.to_json());
                }
                serde_json::Value::Object(obj)
            }
        }
    }
}

fn encode_str(s: &str, out: &mut Vec<u8>) {
    let b = s.as_bytes();
    let n = b.len();
    if n < 32 {
        out.push(0xa0 | n as u8);
    } else if n <= 0xff {
        out.push(0xd9);
        out.push(n as u8);
    } else if n <= 0xffff {
        out.push(0xda);
        out.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        out.push(0xdb);
        out.extend_from_slice(&(n as u32).to_be_bytes());
    }
    out.extend_from_slice(b);
}

fn encode_len(n: usize, fix: u8, fix_max: usize, tag16: u8, tag32: u8, out: &mut Vec<u8>) {
    if n <= fix_max {
        out.push(fix | n as u8);
    } else if n <= 0xffff {
        out.push(tag16);
        out.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        out.push(tag32);
        out.extend_from_slice(&(n as u32).to_be_bytes());
    }
}

fn encode_into(v: &Value, out: &mut Vec<u8>) {
    match v {
        Value::Nil => out.push(0xc0),
        Value::Bool(false) => out.push(0xc2),
        Value::Bool(true) => out.push(0xc3),
        Value::UInt(n) => {
            let n = *n;
            if n < 0x80 {
                out.push(n as u8);
            } else if n <= 0xff {
                out.push(0xcc);
                out.push(n as u8);
            } else if n <= 0xffff {
                out.push(0xcd);
                out.extend_from_slice(&(n as u16).to_be_bytes());
            } else if n <= 0xffff_ffff {
                out.push(0xce);
                out.extend_from_slice(&(n as u32).to_be_bytes());
            } else {
                out.push(0xcf);
                out.extend_from_slice(&n.to_be_bytes());
            }
        }
        Value::Str(s) => encode_str(s, out),
        Value::Array(items) => {
            encode_len(items.len(), 0x90, 15, 0xdc, 0xdd, out);
            for i in items {
                encode_into(i, out);
            }
        }
        Value::Map(entries) => {
            encode_len(entries.len(), 0x80, 15, 0xde, 0xdf, out);
            for (k, v) in entries {
                encode_str(k, out);
                encode_into(v, out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_encodings() {
        // Reference bytes from Python: msgpack.packb(...)
        assert_eq!(Value::UInt(0).encode(), vec![0x00]);
        assert_eq!(Value::UInt(127).encode(), vec![0x7f]);
        assert_eq!(Value::UInt(128).encode(), vec![0xcc, 0x80]);
        assert_eq!(Value::UInt(65536).encode(), vec![0xce, 0, 1, 0, 0]);
        assert_eq!(Value::UInt(1 << 40).encode(), vec![0xcf, 0, 0, 1, 0, 0, 0, 0, 0]);
        assert_eq!(Value::str("a").encode(), vec![0xa1, b'a']);
        assert_eq!(Value::str("x".repeat(34)).encode()[..2], [0xd9, 34]);
        assert_eq!(Value::Bool(true).encode(), vec![0xc3]);
        assert_eq!(
            Value::map(vec![("a", Value::UInt(1)), ("b", Value::Array(vec![]))]).encode(),
            vec![0x82, 0xa1, b'a', 0x01, 0xa1, b'b', 0x90]
        );
    }
}
