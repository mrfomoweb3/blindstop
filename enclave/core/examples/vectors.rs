//! Writes `packages/shared/test/vectors.json`: the cross-language contract between the
//! Rust enclave, the NEAR contract and the TypeScript client.
//!
//!     cargo run -p blindstop-core --example vectors > packages/shared/test/vectors.json
//!
//! `tests/shared_vectors.rs` regenerates it in memory and fails if the file drifts.

fn main() {
    println!("{}", serde_json::to_string_pretty(&blindstop_core_vectors::build()).unwrap());
}

#[path = "../tests/common/vectors.rs"]
mod blindstop_core_vectors;
