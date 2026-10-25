# Examples

The `../src/...` imports run these examples against this checkout. Applications
should install the package and import from `@thruputchain/client`,
`@thruputchain/client/contracts`.

Run examples from the repository root:

```bash
npm run example <name>
```

| Example                     | Default network | What it demonstrates                                           |
| --------------------------- | --------------- | -------------------------------------------------------------- |
| `chain-tip`                 | Futurenet       | Validated connection, chain tip, and nullable release identity |
| `transfer-native-token`     | Futurenet       | Airdrops, pubkey accounts, DefaultWallet, and receipts         |
| `view-native-token-balance` | Localnet        | Public account address and typed contract views                |
| `deploy-counter`            | Localnet        | Native wallet funding, atomic initialization, and readback     |

All four examples support both networks. Set `THRUPUT_NETWORK=localnet` or
`THRUPUT_NETWORK=futurenet` to select one. Futurenet uses the SDK's `futurenet()`
descriptor and `https://rpc.thruput.network`; Localnet uses `localnet()` and
`http://127.0.0.1:9545`.

Set `THRUPUT_RPC_URL` to override the selected endpoint. Set
`THRUPUT_NETWORK_HASH` to pin its base58 signing-network hash, including for a
local node started with a custom identity. Localnet otherwise expects the
all-zero network hash; Futurenet discovers its identity without a pin. A shared
network hash cannot distinguish separate local runtimes. These examples do not
read a runtime manifest.

## Futurenet

`chain-tip` connects through `futurenet()`, validates the endpoint's network
identity, and prints the current chain tip:

```bash
npm run example chain-tip
```

`transfer-native-token` creates an ML-DSA-65 sender and an Ed25519 recipient, materializes
both with airdrops, transfers native tokens through the native-compatible
DefaultWallet, waits for the receipt, and reads both resulting balances:

```bash
npm run example transfer-native-token
```

The sender signs with ML-DSA-65, the post-quantum scheme. `deploy-counter` signs
with Ed25519. Both signers use `fromSeed` with a 32-byte seed and the same wallet
API. Changing the scheme changes the account address, even with the same seed.

The private keys exist only for that process and are never printed or saved.
Any native tokens left in either account become inaccessible when the process
exits.
Each transfer run consumes two Futurenet faucet allocations. Deployment consumes
one. The hosted faucet applies cooldowns and a shared quota.

Run the deployment and balance examples on Futurenet:

```bash
THRUPUT_NETWORK=futurenet npm run example deploy-counter
THRUPUT_NETWORK=futurenet THRUPUT_ADDRESS=PUBLIC_ADDRESS npm run example view-native-token-balance
```

Replace `PUBLIC_ADDRESS` with an address printed by the transfer or deployment.

These examples require an RPC deployment that supports
`getNetworkInfo`. The transfer also requires
`faucet_requestAirdrop`.

## Localnet

Start a local node before running the Localnet examples:

```bash
thruput node
```

Read an ordinary account's native-token balance through the generated ERC-20
binding. Supply its unprefixed, case-sensitive base58 public address; this read does not
need a signer. Replace the example address below with the account to inspect:

```bash
THRUPUT_ADDRESS=29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2 npm run example view-native-token-balance
```

Local manifests contain public accounts only. Each signing example owns its key
and funds it explicitly. It cannot recover a private key from a manifest.

Create a native wallet, fund it explicitly, deploy and initialize the included
Counter contract, increment it, and read the committed value:

```bash
npm run example deploy-counter
```

Run the other two examples against the local node:

```bash
THRUPUT_NETWORK=localnet npm run example chain-tip
THRUPUT_NETWORK=localnet npm run example transfer-native-token
```

## Contract Deployment

`deploy-counter` creates an ephemeral pubkey account and explicitly funds it with
an airdrop. `prepareContractDeployment()` predicts the contract address, then
`wallet.deployContractAndWait()` transfers 50,000,000 raw native-token units
(5 tokens), deploys the code, and initializes the counter to 42 in one
transaction. Funding
and gas budgets are calibrated for the bundled fixture and local runtime; they
are not deployment cost estimates.

`wallet.executeAndWait()` increments the counter through DefaultWallet, and a
typed view at or above the call receipt's height verifies the value is 47.
The transfer example uses the same freshness floor for its balance reads.
If a read backend is behind, the read fails rather than reporting stale state;
this does not undo the committed transaction. The private key is never printed or saved;
any remaining funds become inaccessible when the process exits.

The Counter artifact's source revision, SDK, compiler, and SHA-256 are recorded in
[`fixtures/README.md`](fixtures/README.md). The example prints the canonical
Thruput contract hash computed from the actual artifact. The fixture's build
provenance is distinct from the current SDK used to generate new projects.
Wallet binding provenance and all canonical input hashes are recorded in
[`specs/contracts/README.md`](../specs/contracts/README.md).

To build a contract and generate TypeScript bindings with the CLI version pinned
in [`scripts/integration-versions.json`](../scripts/integration-versions.json):

```bash
thruput build -p counter --bindings ts
```

In a single-package project, omit `-p counter`. The build writes the RV32
artifact, canonical spec, and generated TypeScript binding under
`target/thruput/`.
