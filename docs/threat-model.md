# Threat model

## Assets

1. **Stop levels** (and sizes, markets, trading wallets) of sealed orders.
2. **Positions** on Hyperliquid in trading wallets that approved the Blindstop agent.
3. **Settlement truth** on NEAR: which orders fired, at what fill.

## Parties and what they hold

| Party | Sees plaintext stops | Can trade for users | Can withdraw |
|---|---|---|---|
| User's browser | their own | trading wallet key (full) | yes |
| NEAR contract | no (316-byte ciphertext + commitment) | no | no |
| Keeper | no (tick output is counts and signed reports only) | no | no |
| OutLayer TEE (one run) | yes, inside TDX memory | agent key, **host-held**, used only for reduce-only IOC closes the module composes | no: Hyperliquid agents cannot withdraw |
| OutLayer operator / coordinator | no (TDX) | no | no |
| Project owner (`blindstop-watch.testnet`) | could publish a version that leaks plaintext | could publish a version that trades | no |
| Contract owner | no | no | no; can rotate the pinned keys |

## What is hidden

- Level, size, slippage and existence of a stop: there is nothing on Hyperliquid's book until one fires.
- Which market and which trading wallet a NEAR order is for: both are inside the ciphertext.
- Ciphertext length: every plaintext is padded to 256 bytes, so every envelope is 316 bytes.

## What is still public

- The position itself: size, entry, liquidation price.
- The close order and its fill when a stop fires.
- The NEAR account that placed orders, how many, when, and when they closed.
- That a wallet approved an agent named `blindstop` (one agent address for every user).
- Gloam's vault edges, if the user funds through Gloam.

## Trust assumptions

1. **Intel TDX and OutLayer's keystore.** A broken TEE would reveal plaintext stops and could let an attacker use the agent key to place orders for approved wallets. It cannot withdraw.
2. **The project owner.** Keys are bound to the project uuid, so every version the owner publishes holds the same keys. Mitigations: the attestation names the exact wasm sha256 of each run, the build is reproducible from this repo, and the manifest (network allowlist, HTTPS-only) is inside the hashed wasm. Plan: move project and contract ownership to a DAO.
3. **The contract owner** can rotate the pinned keys (event `enclave_keys_rotated`, `key_epoch` bump, UI warning). A malicious rotation could accept reports from a different key, but cannot decrypt existing orders.
4. **Liveness.** No keeper, no fires. Mitigations: public heartbeats with age shown in the UI; the optional public backstop near liquidation placed with the user's own key; an open-source keeper.
5. **Hyperliquid's mark price** decides triggers, as it does for Hyperliquid's own TP/SL.

## Attacks and defenses

| # | Attack | Defense | Tested by |
|---|---|---|---|
| 1 | Forge a fire report | `env::ed25519_verify` against the pinned enclave key | contract tests, `scripts/attacks.ts` (live) |
| 2 | Replay a valid report | Order must be `Active`; settlement is terminal | contract tests, live |
| 3 | Present order A's report as order B | `order_id` and `commitment` are inside the signed bytes | contract tests, live |
| 4 | Keeper feeds fake prices or orders | Enclave reads only `op` from input; everything else comes from NEAR and Hyperliquid | harness, live |
| 5 | A NEAR RPC lies about the active set | Two independent providers at one finalized height must return identical bytes, else the tick refuses | harness (real wasm) |
| 6 | Copy someone's ciphertext into your own order | AAD binds contract, owner and commitment; it fails to decrypt and is retired `Invalid` | Rust tests, live |
| 7 | Cancel or reveal someone else's order | Owner checks | contract tests, live |
| 8 | Reveal a different level after the fact | Contract recomputes the commitment | contract tests, live |
| 9 | Seal an order naming someone else's trading wallet | `wallet_sig` must recover to `hl_address` over a binding naming the placing NEAR account, the contract and the network | Rust tests, harness, live |
| 10 | Heartbeat signature reused as a fire report | Report kind byte is inside the signed bytes | contract tests, harness |
| 11 | Double-close from concurrent ticks or keepers | Compare-and-swap `sending` record written before the order leaves; reconciliation by cloid; reduce-only | harness (lost-answer scenario) |
| 12 | Run the project with your own payment key | Keys are derived per caller: wrong keys open nothing and sign nothing the contract accepts | design (OutLayer key derivation) |
| 13 | A leaked keeper key | The keeper's NEAR key is a function-call key limited to `record_fire` and `heartbeat`, with a 1 NEAR allowance | deployment |

## Residual risks

- **Latency:** the cross is detected within the tick interval (3 s) plus a run (about 1.5–3 s round trip). Fast wicks can fill worse than a native stop.
- **Partial fills:** an IOC that partially fills is reported as filled with the filled size; the rest of the position is not re-protected by that order.
- **Agent approvals are per name:** a user who later approves another agent named `blindstop` silently disables Blindstop for that wallet. The UI shows approval status from `extraAgents`.
- **Timing correlation:** placing and cancelling orders, and the fire itself, are visible events.
