.PHONY: golden help test test-rust test-contract test-ts harness build build-contract build-enclave web keeper attacks vectors verify

BLINDSTOP_CONTRACT ?= blindstop.testnet

help:            ## list targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /	/'

test: test-rust test-contract test-ts   ## every offline test: Rust + vectors + native scenarios, contract, TypeScript

test-rust:       ## enclave core (incl. Python-SDK signing vectors, shared vectors) + harness scenarios on the native core
	cargo test --release

test-contract:   ## NEAR contract unit tests (Rust 1.95, pinned in contracts/blindstop/rust-toolchain.toml)
	cd contracts/blindstop && cargo test

test-ts:         ## shared formats, Hyperliquid signing vs the Python SDK, keeper loop
	pnpm --filter @blindstop/shared --filter @blindstop/keeper test

harness:         ## build the real OutLayer wasm and run every scenario under wasmtime -> HARNESS PASSED
	scripts/harness.sh

build: build-contract build-enclave web   ## all release artifacts

build-contract:  ## contracts/blindstop/target/near/blindstop_contract.wasm
	cd contracts/blindstop && cargo near build non-reproducible-wasm

build-enclave:   ## the OutLayer component for BLINDSTOP_CONTRACT (default blindstop.testnet)
	cd enclave/room && BLINDSTOP_CONTRACT=$(BLINDSTOP_CONTRACT) cargo build --release --target wasm32-wasip2
	shasum -a 256 enclave/room/target/wasm32-wasip2/release/blindstop-room.wasm

web:             ## production build of the web app
	cd web && pnpm build

keeper:          ## run the keeper (reads keeper/.env)
	cd keeper && node --env-file=.env src/main.ts

attacks:         ## live attacks against the deployed contract + enclave (needs OUTLAYER_PAYMENT_KEY)
	node scripts/attacks.ts

golden:          ## live golden path on Hyperliquid testnet (needs OUTLAYER_PAYMENT_KEY + a funded trading wallet)
	node scripts/golden-path.ts

vectors:         ## regenerate the Rust/TS vectors (Python SDK vectors: see scripts/hl_vectors.py)
	cargo run -q -p blindstop-core --example vectors > packages/shared/test/vectors.json

verify: test harness   ## what CI runs
