# Examples

The `../src/...` imports run these examples against this checkout. Applications
should install the package and import from `@groundhogchain/client`,
`@groundhogchain/client/contracts`, and `@groundhogchain/client/local-dev`.

Run examples from the repository root:

```bash
npm run example <name>
```

| Example            | Network  | What it demonstrates                                           |
| ------------------ | -------- | -------------------------------------------------------------- |
| `chain-tip`        | Devnet   | Validated connection, chain tip, and nullable release identity |
| `transfer-hog`     | Devnet   | Airdrops, pubkey accounts, DefaultWallet, and receipts         |
| `view-hog-balance` | Localnet | Runtime account discovery and typed contract views             |
| `deploy-counter`   | Localnet | Deployment helpers, DevWallet, and readback                    |

Set `GROUNDHOG_RPC_URL` to override a cluster's default endpoint. A Localnet
override must also set `GROUNDHOG_RUNTIME_MANIFEST` to the manifest produced by
that same node; the shared `localnet` network ID cannot distinguish separate
local runtimes.

## Devnet

`chain-tip` connects through `devnet()`, validates the endpoint's network
identity, and prints the current chain tip:

```bash
npm run example chain-tip
```

`transfer-hog` creates two ephemeral pubkey accounts, materializes both with
airdrops, transfers HOG through the native-compatible DefaultWallet, waits for
the receipt, and reads both resulting balances:

```bash
npm run example transfer-hog
```

The private keys exist only for that process and are never printed or saved.
Any HOG left in either account becomes inaccessible when the process exits.
Each run consumes two Devnet faucet allocations.

These examples require an RPC deployment that supports
`groundhog_networkInfo`. The transfer also requires
`groundhog_requestAirdrop`.

## Localnet

Start a local node before running the Localnet examples:

```bash
groundhog node
```

The node records its runtime manifest in the global Groundhog configuration.
`loadLocalDevAccount()` reads that manifest and loads its first `local_user`,
normally `dev-1`. These deterministic signers are for local development only.
Never use them with production networks or funds of value.

Read `dev-1`'s HOG balance through the generated ERC-20 binding:

```bash
npm run example view-hog-balance
```

Deploy the included Counter contract through DevWallet, increment it through a
wallet adapter, and read the committed value:

```bash
npm run example deploy-counter
```

Set `GROUNDHOG_RUNTIME_MANIFEST` to override the active manifest path. When
using `GROUNDHOG_RPC_URL`, both overrides must identify the same local node.

## Contract Deployment

`deploy-counter` prepares a stable predicted address with
`prepareContractDeployment`, then uses `deployContractAndWait` to attach the code,
submit through DevWallet, require successful execution, and verify the returned
address. It increments the counter through `executeAndWait` and reads it back.

The local DevWallet transfers 100,000,000 base units (10 HOG) to each derived
contract address before deployment so that address can pay the storage charge.
This is wallet policy, not part of the protocol deployment mechanism. The wallet
must hold enough for that transfer as well as its own scheduling and storage
requirements. DefaultWallet instead accepts explicit deployment funding and an
optional same-transaction initializer. See [gas and storage funding](../README.md#gas-and-storage-funding).
The generated API docs (`npm run docs`) describe address derivation.

The Counter artifact's source revision, SDK, compiler, and SHA-256 are recorded in
[`fixtures/README.md`](fixtures/README.md). The example prints the canonical
Groundhog contract hash computed from the actual artifact. The fixture's build
provenance is distinct from the current SDK used to generate new projects.
Wallet binding provenance and all canonical input hashes are recorded in
[`specs/contracts/README.md`](../specs/contracts/README.md).

To build a contract and generate TypeScript bindings with the CLI version pinned
in `scripts/integration-versions.json`:

```bash
groundhog build -p counter --bindings ts
```

In a single-package project, omit `-p counter`. The build writes the RV32
artifact, canonical spec, and generated TypeScript binding under
`target/groundhog/`.
