#!/usr/bin/env bash
# Build the OutLayer component for the harness's own contract id (separate target dir, so it
# never clobbers a production build) and run every scenario against it under wasmtime.
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="$PWD/target/harness-wasm"
(cd enclave/room && BLINDSTOP_CONTRACT=blindstop-harness.testnet BLINDSTOP_NETWORK=testnet cargo build -q --release --target wasm32-wasip2)
unset CARGO_TARGET_DIR
cargo run -q --release -p blindstop-harness -- target/harness-wasm/wasm32-wasip2/release/blindstop-room.wasm
