# Spikes and VERIFY items

Every assumption from the build spec, what we checked, and what we found. Dates are UTC.

## Results

| # | Spike | Result | Evidence |
|---|---|---|---|
| S1 | Rust Hyperliquid signing reproduces the official Python SDK | **Pass** (9 Nov) | `cargo test -p blindstop-core --test hl_vectors`: action JSON, msgpack bytes, `connectionId` and `r`/`s`/`v` are byte-identical for 5 orders (mainnet and testnet, small and large prices, `str8` cloids, large asset ids). Vectors: `enclave/core/tests/hl_vectors.json`, made by `scripts/hl_vectors.py` with `hyperliquid-python-sdk==0.24.0`. The TypeScript client passes the same vectors plus `approveAgent`, `withdraw3` and the backstop trigger order. |
| S2 | The same signing code runs inside OutLayer and places a real Hyperliquid order | **Open: needs a funded Hyperliquid testnet wallet** | The enclave builds and signs closes inside the TEE today (the harness recovers the agent address from every signature the real wasm produces). Placing one live needs a wallet with testnet USDC and a position; see "Blocked on funds" below. |
| S3 | OutLayer derives stable x25519, ed25519, secp256k1 keys | **Pass** (9 Nov) | Three HTTPS calls of `{"op":"pubkeys"}` to `blindstop-watch.testnet/blindstop-watcher` returned identical keys: x25519 `edb14684…19d09`, ed25519 `8e355b62…5a7293`, agent `0xad9043b5f362ea82986e035d6ddb2a684f01e077`. About 1.1 s of TEE compute each. |
| S4 | The enclave reads NEAR (two RPCs) and Hyperliquid `/info` from inside the TEE | **Pass** (9–10 Nov) | Tick call `32647a3c-…` read `get_active` from FastNEAR and dRPC at final block 276986710 (1.36 s). Its heartbeat verified on chain (`DPo2D7wJ…`). In the attack run the enclave read Hyperliquid testnet `metaAndAssetCtxs` and `clearinghouseState` and reported `no_position` for order 6. |
| S5 | A browser-sealed order decrypts inside the enclave | **Pass** (10 Nov) | `scripts/attacks.ts` seals with the TypeScript client (`sealOrder`); the enclave opened orders 6 and 8, checked the wallet binding and commitment, and signed reports the contract accepted. Cross-language vectors: `packages/shared/test/vectors.json` (Rust and TypeScript produce identical envelopes from the same keys). |
| S6 | Gloam cross-chain cash out to Arbitrum + Hyperliquid deposit with permit | **Pivot: manual flow** (10 Nov) | `@gloamtrade/sdk@0.6.0` cashes out on the chain the money is on (Base, Ethereum, Tempo, Robinhood Chain and their testnets). It has no cross-chain cash out to Arbitrum. Per spec §10.3 funding ships as documented manual steps in the app; Blindstop moves no money for the user. |

## VERIFY items

| Item | Finding |
|---|---|
| OutLayer target triple | `wasm32-wasip2` (WASI P2 component). The `outlayer` crate refuses `wasm32-wasip1` at compile time. |
| How keys reach the wasm | Not "CKD into wasm memory": OutLayer's keystore derives **signing keys** (`ed25519`, `secp256k1`) that the host holds and signs with, and **encryption keys** (`encrypt`/`decrypt`/`mac`). Blindstop's ed25519 report key and secp256k1 Hyperliquid agent key are host-held, so neither ever enters the module's memory. The x25519 sealing key is `mac("seal", "blindstop:v1:x25519")`, the only secret in module memory, and only during a run. |
| Key binding | Keys are bound to the project's on-chain uuid and the caller. Over HTTPS the caller is the payment key's owner, so the keys belong to `blindstop-watch.testnet` running `blindstop-watcher`. Anyone else who runs the project with their own payment key derives different keys: they cannot open sealed orders and their reports fail the contract's pinned-key check. `caller: "none"` exists only for ed25519 signing keys, so permissionless keepers are not possible with an x25519 key; a second keeper uses an operator-issued payment key. |
| Manifest | Embedded in the wasm custom section `outlayer.manifest` (covered by the attested hash). Ours declares the 4 network hosts exactly, the 2 signing and 2 encryption keys, and `callers: {direct: deny, contract: deny, https: allow}`. The harness parses it from the binary and enforces the allowlist. |
| Project storage | `near:storage` raw functions plus `encryption_keys`; we use the SDK's sealed-record recipe (key `hex(mac(name))`, value `encrypt(value, aad = name)`) with compare-and-swap for fire state and the agent nonce. |
| HTTPS call API | `POST {api}/call/{owner}/{project}` with `X-Payment-Key: owner:nonce:secret`, body `{"input": …}`. Testnet payment keys are funded in `usdc.fakes.testnet` (`get_payment_token_contract` on `outlayer.testnet`), which has a public `mint`. A tick costs about $0.0007. |
| Attestation | `GET {api}/attestations/by-call/{call_id}` returns the record for a run; the keeper exposes the last call id at `/health`. |
| Hyperliquid mark price fields | `metaAndAssetCtxs` → `[ {universe: [{name, szDecimals, …, isDelisted?}]}, [{markPx, oraclePx, midPx, …}] ]`, index-aligned. Checked on testnet 9 Nov (213 assets; BTC index 3, szDecimals 5). |
| Price rounding | 5 significant figures, at most `6 − szDecimals` decimals for perps, integer prices always allowed (as in the SDK's `_slippage_price`). Unit-tested in Rust and TypeScript with the same cases. |
| Hyperliquid testnet faucet | Only claimable by an address that deposited on mainnet. A fresh wallet is funded by a `usdSend` from an existing testnet account. |
| Wallet connector | `@near-wallet-selector` 10.1.4 (Meteor, Intear, MyNearWallet); actions built with `@near-js/transactions` `actionCreators`. |
| Hyperliquid TS SDK | Not used. The browser signs its three action types (`approveAgent`, `withdraw3`, the backstop `order`) with viem against the Python SDK's vectors, which is a smaller surface than adding `@nktkas/hyperliquid`. |
| Bun | Not installed on the build machine; the keeper runs on Node 24, which executes TypeScript directly. No Bun-specific APIs are used. |

## Changes to the spec's formats (both sides updated together)

- `SealedOrderV1` gained `wallet_sig: [u8; 65]` (after `salt`): an EIP-191 signature by the trading wallet over `walletBindingMessage(contract, owner, network)`. Without it any NEAR account could seal an order naming someone else's wallet, and if that wallet had approved the shared agent, the enclave would close their position. Attack 9 shows the enclave retiring such an order.
- `FireReportV1.outcome` gained `3 = invalid`, so an order that does not open is retired instead of costing work every tick; the contract maps it to status `Invalid`.
- Coins are restricted to main-dex perp names (`[A-Za-z0-9]{1,16}`); builder-deployed perp dexes use different asset indices.

## Blocked on funds

S2 and the live golden path need a Hyperliquid testnet wallet with test USDC and an open position. With one available:

```bash
# approve the agent and seal a take-profit just above mark in the web app, then
make keeper            # or leave the deployed keeper running
# watch /app/orders turn Fired, and confirm openOrders was [] before the fire:
curl -s https://api.hyperliquid-testnet.xyz/info -d '{"type":"frontendOpenOrders","user":"0x…"}'
```
