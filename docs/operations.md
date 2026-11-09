# Operating Blindstop

## Accounts (testnet)

| Account | Role | Key used where |
|---|---|---|
| `blindstop.testnet` | the contract | deploy only |
| `blindstop-watch.testnet` | contract owner, OutLayer project owner, payment-key owner (the enclave keys are derived for this account) | admin and OutLayer CLI only |
| `blindstop-keeper.testnet` | pays gas for settlements | a function-call key limited to `blindstop.testnet` `record_fire`, `heartbeat`, 1 NEAR allowance |

## Deploy from scratch

```bash
# 0. accounts (testnet faucet)
near account create-account sponsor-by-faucet-service <contract>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
#    likewise <operator>.testnet and <keeper>.testnet

# 1. OutLayer, in its own config dir so other projects' logins are untouched
export OUTLAYER_HOME=~/.blindstop-outlayer
outlayer login testnet                           # account <operator>.testnet + its key
make build-enclave BLINDSTOP_CONTRACT=<contract>.testnet
outlayer upload enclave/room/target/wasm32-wasip2/release/blindstop-room.wasm
outlayer deploy blindstop-watcher <fastfs-url>
outlayer keys create > /dev/null                 # stored in $OUTLAYER_HOME/testnet/payment-keys.json; never print it
near contract call-function as-transaction usdc.fakes.testnet storage_deposit json-args '{"account_id":"<operator>.testnet"}' prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' sign-as <operator>.testnet network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction usdc.fakes.testnet mint json-args '{"account_id":"<operator>.testnet","amount":"100000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <operator>.testnet network-config testnet sign-with-legacy-keychain send
outlayer keys topup <nonce> --usd 50

# 2. Keys: ask the enclave, then pin them in the contract
curl -s -X POST https://testnet-api.outlayer.ai/call/<operator>.testnet/blindstop-watcher \
  -H "X-Payment-Key: $PAYMENT_KEY" -d '{"input":{"op":"pubkeys"}}'

# 3. Contract
make build-contract
near contract deploy <contract>.testnet use-file contracts/blindstop/target/near/blindstop_contract.wasm \
  with-init-call new json-args '{"owner":"<operator>.testnet","enclave_ed25519":"…","enclave_x25519":"…","agent_address":"0x…"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send

# 4. Keeper key
near account add-key <keeper>.testnet grant-function-call-access --allowance '1 NEAR' \
  --contract-account-id <contract>.testnet --function-names 'record_fire, heartbeat' \
  autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
```

## Run the keeper

```bash
cp keeper/.env.example keeper/.env   # fill KEEPER_PRIVATE_KEY (the function-call key) and OUTLAYER_PAYMENT_KEY
make keeper
curl localhost:8787/health
curl localhost:8787/metrics
```

On Fly.io (from the repo root):

```bash
fly launch --no-deploy --copy-config -c keeper/fly.toml
fly secrets set -c keeper/fly.toml KEEPER_PRIVATE_KEY=… OUTLAYER_PAYMENT_KEY=…
fly deploy -c keeper/fly.toml --dockerfile keeper/Dockerfile
```

### A second keeper

Two keepers are safe: the enclave writes its `sending` record with compare-and-swap before any order leaves, re-emits identical reports until NEAR records them, and the contract refuses a second settlement (the keeper counts it as `already settled`). A second keeper needs:

- a payment key **owned by the operator account** (`outlayer keys create` as the operator, then hand it over). A payment key owned by anyone else derives different enclave keys, so that keeper's runs open nothing;
- any NEAR account to pay gas.

### Costs (testnet, measured)

- OutLayer: about $0.0007 per tick. At a 3 s interval, about $0.80/hour in test USDC.
- NEAR: a heartbeat or settlement costs well under 0.001 NEAR of gas.

## Rotate enclave keys

Deploying a new version of the same project keeps the same keys (they are bound to the project uuid). Only a new project or operator changes them. Then:

```bash
near contract call-function as-transaction <contract>.testnet set_enclave_keys json-args '{"enclave_ed25519":"…","enclave_x25519":"…","agent_address":"0x…"}' … sign-as <operator>.testnet …
```

Active orders sealed to the old x25519 key no longer open; the next tick retires them as `Invalid` and the app tells their owners to re-seal. Users must approve the new agent address.

## Emergency

`pause` stops new orders (cancels still work). Stopping every keeper stops fires; users' public backstops, if they kept them, still protect against liquidation.
