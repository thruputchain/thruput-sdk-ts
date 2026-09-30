# Examples

The `../src/...` imports run these examples against this checkout. Applications
should install the package and import from `@groundhogchain/client`,
`@groundhogchain/client/contracts`, and `@groundhogchain/client/local-dev`.

Run examples from the repository root:

```bash
npm run example <name>
```

| Example            | Network  | What it demonstrates                                       |
| ------------------ | -------- | ---------------------------------------------------------- |
| `chain-tip`        | Devnet   | Validated cluster connection and basic RPC actions         |
| `transfer-hog`     | Devnet   | Airdrops, pubkey accounts, DefaultWallet, and receipts     |
| `view-hog-balance` | Localnet | Runtime account discovery and typed contract views         |
| `deploy-counter`   | Localnet | Native wallet funding, atomic initialization, and readback |

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

Create a native wallet, fund it explicitly, deploy and initialize the included
Counter contract, increment it, and read the committed value:

```bash
npm run example deploy-counter
```

Set `GROUNDHOG_RUNTIME_MANIFEST` to override the active manifest path. When
using `GROUNDHOG_RPC_URL`, both overrides must identify the same local node.

## Contract Deployment

`deploy-counter` creates an ephemeral pubkey account and explicitly funds it with
an airdrop. `prepareContractDeployment()` predicts the contract address, then
`wallet.deployContractAndWait()` transfers 50,000,000 raw HOG units (5 HOG),
deploys the code, and initializes the counter to 42 in one transaction. Funding
and gas budgets are calibrated for the bundled fixture and local runtime; they
are not deployment cost estimates.

`wallet.executeAndWait()` increments the counter through DefaultWallet, and a
typed view verifies the value is 47. The private key is never printed or saved;
any remaining funds become inaccessible when the process exits.

The Counter fixture's source and artifact provenance are recorded in
[`examples/fixtures/README.md`](fixtures/README.md). Wallet binding provenance
and canonical input hashes are recorded in
[`specs/contracts/README.md`](../specs/contracts/README.md).

To build a contract and generate TypeScript bindings with the CLI version pinned
in [`scripts/integration-versions.json`](../scripts/integration-versions.json):

```bash
groundhog build -p counter --bindings ts
```

In a single-package project, omit `-p counter`. The build writes the RV32
artifact, canonical spec, and generated TypeScript binding under
`target/groundhog/`.
