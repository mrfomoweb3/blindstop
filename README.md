# Blindstop

**Hidden stop-losses and take-profits for Hyperliquid.** Your stops never touch the public order book. A sealed enclave on NEAR (OutLayer, Intel TDX) holds them, watches the mark price, and closes your position when your level is hit.

Built at NEAR HACKATHON. Tracks: Privacy & Private AI · Unstoppable DeFi · AI Security & Defense.

> Gloam hides who you are. Blindstop hides where your stops are.

![Blindstop](docs/screenshot.png)

## The problem

- Hyperliquid runs a fully on-chain order book. Every order is public, stop-losses and take-profits included: `POST /info {"type":"frontendOpenOrders","user":…}` returns any wallet's trigger levels.
- Tracking tools aggregate those levels across wallets and show where stops, take-profits and liquidations cluster ([CoinMarketMan: liquidity clusters on Hyperliquid](https://coinmarketman.com/blog/liquidity-clusters-on-hyperliquid-how-to-read-where-the-market-will-move-next--en/), [stop placement using liquidation clusters](https://coinmarketman.com/blog/stop-loss-placement-using-liquidation-clusters-on-hyperliquid--en/)).
- Visible positions get hunted. Public whale positions on Hyperliquid were followed and liquidated in plain view ([Cointelegraph](https://cointelegraph.com/news/hyperliquid-whale-loss-100-million-bitcoin-dips-below-105)), and in the XPL pre-market a few wallets cleared the book and forced mass liquidations ([The Defiant](https://thedefiant.io/news/defi/whale-trades-on-hyperliquid-wipe-out-xpl-order-book-triggering-mass-liquidations)).
- Existing fixes don't cover Hyperliquid. [Aster's hidden orders](https://docs.asterdex.com/trading/perpetuals/order-types/hidden-order) work only on Aster, and only for limit orders. [Gloam](https://gloam.trade/docs/privacy-model) hides *who* funded a wallet; what the wallet does after that is public.

Nobody hides **where your stops are** on Hyperliquid. Blindstop does.

## How it works

```
 browser ── seal(order) to the enclave's x25519 key ──▶ NEAR  blindstop.testnet
   │                                                    place_order(316-byte ciphertext, commitment)
   │ approveAgent(enclave agent)                                   │
   ▼                                                               │ get_active (2 independent RPCs,
 Hyperliquid ◀── reduce-only IOC close, signed by the agent ──┐    │ same finalized block, must match)
                                                              │    ▼
 keeper (every 3 s) ── POST /call ──▶ OutLayer TEE (Intel TDX): decrypt → check wallet binding →
   │                                  read mark price → crossed? → close → sign report (ed25519)
   └── record_fire(report, sig) ──▶ NEAR: ed25519_verify against the pinned key → order Fired
```

1. **Seal.** The browser serializes the order (Borsh), pads it to 256 bytes, and encrypts it to the enclave (X25519 + HKDF-SHA256 + ChaCha20-Poly1305). The authenticated data binds the contract, the NEAR owner and the commitment. NEAR stores the ciphertext and `sha256("blindstop:v1:order" ‖ order)`. The market and trading wallet are inside the ciphertext.
2. **Bind.** The order carries an EIP-191 signature by the trading wallet that names the NEAR account. Without it, anyone could seal an order naming *your* wallet and have the shared agent close your position.
3. **Watch.** A stateless keeper calls the enclave every few seconds. The enclave reads the active orders itself from FastNEAR and dRPC at one finalized height (refusing if they differ), and mark prices from Hyperliquid. Its input carries only `{"op":"tick"}`, so a keeper can delay ticks but cannot change outcomes.
4. **Close.** On a cross, the enclave writes a compare-and-swap "sending" record, signs a reduce-only IOC close as the user's approved agent, and returns an ed25519-signed report. Lost answers are reconciled by client order id, never re-sent; rejections are retried with fresh ids, up to 5 times.
5. **Settle.** Anyone can submit the report. The contract verifies it against the pinned enclave key and the order's commitment, then marks the order `Fired` (or `Skipped`, `Rejected`, `Invalid`).
6. **Prove.** After an order closes, its owner can reveal the plaintext. The contract checks it against the commitment it stored at placement, and `/verify` re-checks it in your browser.

## What is hidden, and what is still public

| Hidden | Still public |
|---|---|
| Stop and take-profit levels, sizes, slippage: nothing on Hyperliquid's book until one fires | The position itself: size, entry, **liquidation price** |
| Which market a NEAR order is for | The close order and fill when a stop fires |
| Which Hyperliquid wallet it protects | The NEAR account that placed orders, how many, and when |
| Ciphertext length (every envelope is 316 bytes) | That the wallet approved an agent (one agent address for every user) |
| With Gloam funding: which main wallet funded the trading wallet, unless amounts or timing link them | Gloam deposits and cash-outs at the vault |

Details and trust assumptions: [docs/threat-model.md](docs/threat-model.md).

## NEAR technology used

- **NEAR contract** (`contracts/blindstop`, near-sdk 5.29): stores only ciphertext and commitments; settles enclave reports with `env::ed25519_verify` against a pinned key; NEP-297 events (`order_placed`, `order_cancelled`, `order_fired`, `order_revealed`, `heartbeat`, `enclave_keys_rotated`); storage staking with refunds when an order closes; owner-only reveal of closed orders with on-chain commitment check; pause, per-owner caps, key rotation with epochs.
- **OutLayer** (`enclave/room`, `wasm32-wasip2`): a project run over HTTPS with a payment key. It uses
  - **host-held signing keys**: ed25519 `report` signs reports; secp256k1 `hl-agent` is the Hyperliquid agent and never enters module memory;
  - **encryption keys**: `seal`, whose MAC derives the x25519 key orders are sealed to, and `state`, which seals the module's own records;
  - **sealed project storage** with compare-and-swap, for idempotent fires and a strictly increasing agent nonce;
  - **a manifest inside the attested wasm**: HTTPS-only callers and a network allowlist of exactly four hosts;
  - **per-run TDX attestations** that name the wasm sha256.
- **Function-call access keys:** the keeper signs with a key limited to `record_fire` and `heartbeat`.

## Status

Every claim, with what proves it.

| Claim | Proof |
|---|---|
| Rust Hyperliquid signing is byte-identical to the official Python SDK | `cargo test -p blindstop-core --test hl_vectors` (5 orders; vectors from `hyperliquid-python-sdk==0.24.0` via `scripts/hl_vectors.py`) |
| Browser signing (`approveAgent`, `withdraw3`, backstop order) matches the Python SDK | `pnpm --filter @blindstop/shared test` |
| Rust, TypeScript and the contract agree on every byte (orders, commitments, envelopes, reports) | `packages/shared/test/vectors.json`, checked by `cargo test`, `vitest` and the contract tests |
| The real OutLayer wasm runs end to end locally | `make harness` → `HARNESS PASSED` (14 scenarios under wasmtime: fire, idempotency, no-position, invalid and hostile orders, RPC disagreement, input injection, rejection retries, lost-answer reconciliation, confirm ticks) |
| Enclave keys are stable inside the real TEE | 3 calls of `pubkeys` returned identical keys ([docs/spikes.md](docs/spikes.md), S3) |
| Contract deployed on testnet with the enclave keys pinned | [`blindstop.testnet`](https://testnet.nearblocks.io/address/blindstop.testnet), init tx `5kcM7eQJKWr3h395gFcbSEBzCEx3hWrPZTn4dtzFJRuE` |
| A TEE-signed heartbeat verifies on chain | tx `DPo2D7wJWecNExA4n8UoG6t2mtvm5EJUjQq32JQXdisH`; live age on `/watcher` |
| A browser-sealed order is opened and settled by the real enclave | order 6: enclave report settled by a third party, tx `AjQgGT7C6aQmDTJCGKpYBnkU1FytQRR5HAj79WGTTDTH`; revealed, tx `5zPJSAfpZ4edx32eadspJGUUEos9FQV3aFSE4XVSUtPE` |
| Attacks are refused on testnet | `node scripts/attacks.ts` → `ALL ATTACKS REFUSED` ([log](docs/evidence/attacks-testnet.log)) |
| A sealed stop fires on Hyperliquid testnet and is recorded `Fired` | **Open.** Needs a funded Hyperliquid testnet wallet (the faucet requires a mainnet deposit history). Steps in [docs/spikes.md](docs/spikes.md#blocked-on-funds) |

## Run it

### No accounts needed

```bash
rustup target add wasm32-wasip2           # contract tests use Rust 1.95 (rust-toolchain.toml)
pnpm install
make test       # Rust (core, vectors, native scenarios) + contract + TypeScript
make harness    # builds the real OutLayer component and prints HARNESS PASSED
```

`make test` passes when every `cargo test` reports `test result: ok` and Vitest reports no failures. The 14 harness scenarios print `ok - …` lines.

### Against testnet

```bash
# web app (reads blindstop.testnet; no secrets in NEXT_PUBLIC_*)
cp web/.env.example web/.env.local && cd web && pnpm dev     # http://localhost:3000

# keeper (needs an operator-owned OutLayer payment key and a NEAR key)
cp keeper/.env.example keeper/.env && make keeper             # /health and /metrics on :8787

# attacks against the live contract + enclave
OUTLAYER_PAYMENT_KEY=… node scripts/attacks.ts
```

Deploying your own contract, enclave and keeper: [docs/operations.md](docs/operations.md).

### Repository

```
contracts/blindstop   NEAR contract (near-sdk 5)
enclave/core          pure logic: formats, crypto, triggers, Hyperliquid signing, tick state machine
enclave/room          the OutLayer component (wasm32-wasip2): binds core to OutLayer storage, keys, HTTP
enclave/harness       runs the real wasm under wasmtime against fixtures and a signature-checking fake /exchange
packages/shared       TypeScript: formats, sealing, Hyperliquid signing, NEAR tx signing, contract views
keeper                Node 24 service: tick loop, settlement, /health, /metrics, Dockerfile, fly.toml
web                   Next.js 15 app: onboarding, positions, sealing, orders, verify, watcher
scripts               attacks.ts, harness.sh, hl_vectors.py
docs                  spikes, threat model, operations, demo script
```

## Known limitations

- **Liveness:** if no keeper runs, stops do not fire. The app shows heartbeat age, and offers a public backstop near liquidation placed with your own key.
- **Latency:** a stop fires within the tick interval (3 s) plus one enclave run (about 1.5–3 s) after the cross. Fast wicks can fill worse than a native stop.
- **The liquidation price is public,** as it is for every Hyperliquid position.
- **Trust:** Intel TDX and OutLayer's keystore; the project owner (every version they publish holds the same keys); the contract owner (can rotate pinned keys). Ownership is not yet locked or moved to a DAO.
- **Keepers:** the enclave keys are bound to the operator account, so a second keeper uses an operator-issued payment key. It cannot be fully permissionless with OutLayer's current key model.
- **Funding:** Gloam's SDK has no one-step cash out to Arbitrum, so private funding is a documented manual flow.
- **Markets:** main-dex Hyperliquid perps only; partial IOC fills are reported as filled with the filled size.
- **Live golden path on Hyperliquid testnet** is not yet recorded (see Status).

## Libraries, templates and AI use

- Existing libraries: `near-sdk`, `@near-wallet-selector/*`, `@near-js/transactions`, the OutLayer SDK (`outlayer`, `wasi-http-client`), `viem`, `@noble/curves` / `hashes` / `ciphers`, RustCrypto crates (`x25519-dalek`, `ed25519-dalek`, `k256`, `chacha20poly1305`, `hkdf`, `sha2`, `sha3`), `borsh`, `wasmtime`, Next.js, Tailwind CSS, zod, Vitest. `@gloamtrade/sdk` was evaluated for funding (see Known limitations).
- Signing vectors come from the official `hyperliquid-python-sdk` (0.24.0).
- OutLayer's documentation and connector examples informed the manifest and sealed-storage patterns.
- Code was written with Claude Code.

## Other entry by the same team

[VEIL](https://github.com/mrfomoweb3/veil), a separate NEAR HACKATHON entry. The two projects share no code.

## License

MIT, see [LICENSE](LICENSE).
