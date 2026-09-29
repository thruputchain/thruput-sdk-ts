# @groundhogchain/client

TypeScript client for the [Groundhog](https://github.com/groundhogchain) blockchain.

It provides typed JSON-RPC actions, transaction construction and signing,
HTTP and mock transports, and generated contract bindings. Generated methods
share one descriptor API for invocations, typed views, root-receipt decoding,
returns, and contract exceptions. Generated events provide strict decoding,
named topic filters, and receipt extraction.

## Install

```sh
npm install @groundhogchain/client
```

The package is currently distributed through GitHub Packages and requires a
token with `read:packages`. See [Registry auth](#registry-auth-one-time-setup).

## Usage

```ts
import { createGroundhogClient, HttpTransport } from "@groundhogchain/client";

const client = await createGroundhogClient({
  transport: new HttpTransport("https://rpc.example.com"),
});

const tip = await client.getChainTip();
const txHash = await client.sendTransaction(signedTransaction);
```

Enable HTTP batching to group concurrent calls into one JSON-RPC array:

```ts
const client = await createGroundhogClient({
  transport: new HttpTransport("https://rpc.example.com", {
    batch: true, // defaults to { maxSize: 100, waitMs: 0 }
  }),
});

const [tip, version] = await Promise.all([
  client.getChainTip(),
  client.getVersion(),
]);
```

Batching is opt-in and requires an endpoint that accepts JSON-RPC arrays.
It reduces HTTP requests but does not guarantee a shared snapshot, execution
order, or atomicity. Await dependent calls separately. See `HttpTransportOptions`
in the API reference for timeout, cancellation, and error behavior.

Pass a cluster to fetch the endpoint's network identity during connection and
verify it against the cluster's `networkHash`, if supplied:

```ts
import { createGroundhogClient, devnet, toHex0x } from "@groundhogchain/client";

const client = await createGroundhogClient({
  cluster: devnet(),
});

console.log(toHex0x(client.network.networkHash));
```

`devnet()` uses `https://rpc.thruput.network`. Applications with an explicit
`rpcUrl`, `HttpTransport` URL, or environment configuration should update that
value to use the stable endpoint; upgrading the package preserves overrides.

Development clusters expose a typed airdrop action. It generates an
idempotency nonce and polls pending attempts until the transfer commits:

```ts
const airdrop = await client.requestAirdrop({ recipient: accountAddress });
console.log(airdrop.txHash, airdrop.rawAmount);
```

Remote airdrops retain the faucet's per-recipient cooldown and share the
gateway's configured aggregate quota. Localnet airdrops are unlimited. Use
`requestAirdropAttempt` when an application needs to persist the nonce or
control polling itself.

The predefined clusters are `mainnet`, `devnet`, and `localnet`. Declare a
deployment-specific cluster inline, or use `defineCluster` when the descriptor
will be reused. Devnet and localnet include default RPC URLs; pass `rpcUrl` to
override them. Mainnet has no default endpoint yet. Supply a `networkHash` when
the application must pin the protocol identity used for transaction signing.
`devnet()` is unpinned by default; use `devnet({ networkHash })` to pin it.
Identity is checked at connection, not continuously after network resets.
Pass an explicit transport for custom headers or request handling. Omit
`cluster` to use an unknown endpoint without runtime identity validation.

```ts
const client = await createGroundhogClient({
  cluster: {
    name: "private-devnet",
    rpcUrl: "https://rpc.example.com",
    capabilities: ["airdrop"],
  },
});
```

Common protocol types and constructors are available directly from
`@groundhogchain/client`: addresses, hashes, block heights, gas amounts,
`ContractEntrypointID`, `Calldata`, `TimePoint`, and `InvokeFlagSet`. The client also
exports `Invocation`, `Transaction`, `SignedTransaction`, `InvokeFlag`, and
`ExecResult`. These are the original protocol definitions; the full protocol and
XDR API remains available from `@groundhogchain/protocol`.

```ts
import { gasAmount, type ContractAddress } from "@groundhogchain/client";
```

Generated contract bindings are exported separately. Each interface nests its
methods and their argument, result, and exception types under the major version
its entrypoints hash (`ERC20.v0_1.transfer`, `ERC20.v0_1.TransferArgs`); named
types, enum values, and event descriptors nest under the declaring crate and
major (`groundhog_erc20_if.v0_1.events.TransferEvent`).

```ts
import { ERC20 } from "@groundhogchain/client/contracts";

const balance = await ERC20.v0_1.getBalanceOf.view({
  client,
  contract: tokenAddress,
  args: { addr: accountAddress },
});

const transfer = ERC20.v0_1.transfer.invocation(tokenAddress, gasLimit, {
  receiver: recipientAddress,
  amount: 1_000n,
});
```

### Event pages

Use a generated event descriptor to fetch one page with typed topics and fields:

```ts
import { groundhog_erc20_if } from "@groundhogchain/client/contracts";

const { TransferEvent } = groundhog_erc20_if.v0_1.events;
const page = await client.getContractEvents({
  event: TransferEvent,
  contractAddresses: [tokenAddress],
  topics: { to: accountAddress },
  limit: 20,
});

for (const transfer of page.events) {
  console.log(transfer.txHash, transfer.blockHeight, transfer.fields.amount);
}
```

This makes one RPC request. Pass `page.cursor` with the same filters when the user
requests another page. The result retains `latestBlock`, `oldestBlock`, and each
event's emitter and sequence number. Existing generated bindings work unchanged.

For a background scan, the raw-page iterator handles cursor advancement:

```ts
const query = {
  filters: [TransferEvent.filter({ contractAddresses: [tokenAddress] })],
  limit: 200,
};
for await (const page of client.iterateEventPages(query, { signal })) {
  await processPage(page);
  if (shouldPause()) break;
}
```

The iterator fetches on demand, follows empty pages with continuation cursors,
and stops at an empty cursor. It rejects repeated cursors and propagates RPC
errors. It does not prefetch, retry, subscribe, or persist checkpoints. Applications
own processing and history-coverage checks; `latestBlock` is the indexer's head,
not proof that the current page has covered every event through that block.

Node.js applications targeting `groundhog node` can load a deterministic local
signer from its active runtime manifest:

```ts
import { loadLocalDevAccount } from "@groundhogchain/client/local-dev";

const { address, signer } = await loadLocalDevAccount();
const faucet = await loadLocalDevAccount({ role: "faucet" });
```

The `local-dev` entrypoint is for local development only. Its deterministic
signers must never be used with production networks or funds of value.

## Wallet clients

A wallet client binds account authorization and signers to an existing client:

```ts
import {
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  devnet,
  PrivateKeySigner,
} from "@groundhogchain/client";

const client = await createGroundhogClient({ cluster: devnet() });
const signer = new PrivateKeySigner(secretKey);
const account = createPubkeyAccount({ signer, nonce: 0n });
const wallet = createWalletClient({ client, account });

await wallet.requestAirdrop();
const balance = await wallet.getBalance();
```

Use `createSourceAddressAccount` for an existing account contract, including
the wallets created by `groundhog node`:

```ts
import { bitMap, weight } from "@groundhogchain/protocol";
import {
  createSourceAddressAccount,
  createWalletClient,
  devWalletAdapter,
} from "@groundhogchain/client";
import { loadLocalDevAccount } from "@groundhogchain/client/local-dev";

const local = await loadLocalDevAccount();
const account = createSourceAddressAccount({
  address: local.address,
  signers: [{ signer: local.signer, publicKeyId: 0n }],
  allowedKeys: bitMap(0x01n),
  requiredWeight: weight(1n),
});
const wallet = createWalletClient({
  client,
  account,
  invocationAdapter: devWalletAdapter,
});
```

Wallet clients prepare fresh transaction expiry and replay nonces, sign with
the account's configured signers, and submit transactions. Pubkey accounts use
the native-compatible DefaultWallet adapter automatically. The signing network
comes from a cluster-validated client's `networkHash`.
When binding an unqualified client, pass an explicit `networkHash` to
`createWalletClient`.

Choose a workload-specific root gas budget: it reserves scheduling capacity
against the sender's free HOG even though gas is not burned. New storage also
needs HOG deposits at the address that owns it. See
[gas and storage funding](#gas-and-storage-funding) before copying
budgets or sending a small first credit to a fresh address.

Source-address accounts expose `execute` when configured with an adapter:

```ts
const txHash = await wallet.execute({
  invocation: innerInvocation,
  gasLimit: walletGasLimit,
});
const receipt = await wallet.waitForTransactionReceipt(txHash);
```

Use `prepareExecution` to inspect the wrapped transaction before signing. Both
execution methods accept `nonce`, `blockExpiryHeight`, `expiryBlocks`, and
`contractsToDeploy` overrides.

Native wallets deploy through one atomic operation with an explicit funding
amount and an optional initializer. Prepare the deployment identity first, then
compose an initializer using the generated contract binding:

```ts
import { prepareContractDeployment } from "@groundhogchain/client/wallet";
import { Counter } from "./generated/counter.js";

const deployment = prepareContractDeployment({
  deployer: wallet.account.address,
  contract: rv32Artifact,
});
const result = await wallet.deployContractAndWait(deployment, {
  gasLimit: deploymentGas,
  amount: authorizedFunding,
  initializer: Counter.v0_1.initialize.invocation(deployment.address, initGas, {
    initialValue: 42n,
  }),
});
```

`amount` is raw HOG, chosen by the caller; `0n` skips the transfer. The target's
existing balance plus this amount must cover deployment and initialized storage.
There is no automatic cost estimate or prefunding transaction. The initializer
must target the predicted address, sees the wallet as its caller, and returns no
value to the deployment client. An abort or fault rolls back all three steps.
Omit `initializer` when no call is required.

This API requires the unified native `DefaultWallet.v0_1.deploy` runtime ABI; older
nodes are unsupported and there is no two-transaction fallback. The legacy
DevWallet adapter supports calls, but rejects this deployment API. Provider
wallets accept the same deployment options and retain their explicit signing
and approval-persistence boundary.

The explicit root-invocation APIs remain available for advanced workflows:

```ts
const transaction = await wallet.prepareTransaction({
  invocation: rootInvocation,
  expiryBlocks: 100n,
});
const signed = await wallet.signTransaction(transaction);
const submittedHash = await wallet.sendTransaction(signed);

const txHash = await wallet.sendInvocation({ invocation: rootInvocation });
const receipt = await wallet.waitForTransactionReceipt(txHash);
```

`prepareTransaction` accepts explicit `nonce`, `blockExpiryHeight`,
`expiryBlocks`, and `contractsToDeploy` overrides. Without overrides it uses a
cryptographically random 64-bit nonce and expires 100 blocks after the current
chain tip.

The SDK includes `defaultWalletAdapter` and `devWalletAdapter`. Custom account
contracts can publish their generated binding and a structural adapter without
changing the SDK:

```ts
const customWalletAdapter = defineWalletInvocationAdapter({
  createRootInvocation(accountAddress, request: CustomWalletRequest) {
    return CustomWallet.v0_1.execute.invocation(
      accountAddress,
      request.gasLimit,
      {
        call: request.invocation,
        policy: request.policy,
      },
    );
  },
});
```

Wallet binding returns an independent object without changing the supplied public
client. Multiple accounts can share one public client. Use `executeAndWait` to
require successful execution, or `executeCallsAndWait` to also decode ordered,
typed child results. Provider-backed helpers require `onSigned` to persist signed
evidence before broadcast. Generated API docs describe the full lifecycle.

### Gas and storage funding

Gas is not burned, but the declared root budget reserves scheduling capacity
against the sender's free HOG. Funding a target contract's storage does not fund
the sender's capacity. Use measured budgets for each workload; `walletGasLimit`
sums explicit child budgets and a calibrated overhead, without estimating gas.

A new native HOG balance item needs a deposit at the recipient address. A large
enough first credit can fund it; a small credit can be excluded with
`recentFailure` / `insufficientFunds`. The transfer example funds both accounts first
because its 1,000-unit credit cannot cover a new balance item's deposit.

The live funding test verifies an excluded 1,000-unit first credit, a successful
100,000-unit first credit with a deposit deduction, and a later 1,000-unit credit
without another balance-item deposit. It uses 500,000 child gas and 1,000,000 root
gas. Verified locally with CLI 0.19.0-pre.2 and hog-devnode 0.1.29-rc.3; storage
costs depend on runtime configuration.

A deployed contract's storage needs HOG at its address too. The native deployment
API above transfers the explicit `amount` before deploying and optionally
initializing the contract in the same transaction. Size that amount for the code
and initialized storage, and budget root gas for the complete operation.

The standard ERC20 binding uses `adjustAllowance` with
`{ spender, difference, exclusive }`, not `approve`. `difference` is signed:
positive increases the allowance, negative reduces it. Reading the current
allowance and submitting a delta cannot guarantee an exact target when
concurrent transactions also change it; set `exclusive` to `true` to lock the
allowance entry for the transaction so a concurrent change conflicts instead
of interleaving. `clearAllowance({ spender })` revokes an allowance and deletes
its storage entry, and `clearBalance()` deletes the caller's empty balance
entry. Allowance changes emit `AllowanceChangeEvent` with the signed
`difference`; the earlier `ApprovalEvent` is gone with interface 0.1.41.

A receipt proves commitment; inspect its execution result. `invalid` reports
rejection, while `recentFailure` is an advisory scheduling conflict. A timeout or
cancellation stops observation without proving the outcome. Preserve signed
evidence and resume observing the original hash instead of automatically re-signing.

## Signed operations

A signed operation authorizes an on-chain action off-chain: the signer signs a
`#[contract_type]` payload together with the network, the verifying contract,
and a replay guard (a signer-chosen nonce plus an expiry height), and anyone
can submit it. The contract verifies it with the `groundhog-signed-op` Rust
component against the key it holds; nothing on the wire names the signer. The
`@groundhogchain/client/signed-op` entrypoint is the client half.

```ts
import {
  defineSignedOperation,
  randomNonce,
} from "@groundhogchain/client/signed-op";
import { spec, MyWallet, type my_wallet } from "./generated/my_wallet.js";

// Bind the payload type from the contract's generated spec. Its definition is
// part of the signed bytes, so a payload with the same encoding but a
// different type never shares a signature. When another crate or module also
// declares `Transfer`, pass its full spec id ({ crate_name, major,
// module_path, declared }) as `typeName` instead.
const transfer = defineSignedOperation<my_wallet.v0_1.Transfer>({
  typeDefs: spec.type_defs,
  typeName: "Transfer",
});

// Nothing on chain needs reading before signing: the contract consumes each
// (nonce, expiry) pair once, in any order, and forgets it after the expiry.
const { op, signature } = await transfer.sign(signer, {
  network: networkHash,
  verifyingContract: walletAddress,
  blockExpiryHeight: currentHeight + 100n,
  nonce: randomNonce(),
  body: { to: recipient, amount: 42n },
});

// `op` and `signature` are the arguments of whichever entrypoint hands the
// operation to the verifying contract; the submitter need not be the signer.
const invocation = MyWallet.v0_1.submit.invocation(walletAddress, gasLimit, {
  op,
  signature,
});
```

`signedOperationPreimage` exposes the exact bytes a signature covers, for
signers this package does not drive.

## Examples

- [`chain-tip.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/chain-tip.ts) connects to Devnet and reads its latest block.
- [`transfer-hog.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/transfer-hog.ts) funds two pubkey accounts and transfers HOG on Devnet.
- [`view-hog-balance.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/view-hog-balance.ts) reads local `dev-1`'s HOG balance.
- [`deploy-counter.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/deploy-counter.ts) deploys and calls a Counter contract through DevWallet.

See the [examples guide](https://github.com/groundhogchain/client-ts/blob/main/examples/README.md) for local-node setup and configuration.

Use the root entrypoint for the client and common runtime APIs. Focused
entrypoints are available for transactions, transports, contract runtime
helpers, generated standard contracts, signers, and standalone actions.

## What's in this repo

- `src/client.ts` — async `createGroundhogClient` factory for unqualified and cluster-validated clients.
- `src/actions/` — RPC actions grouped by namespace:
  - `public/` — chain, account, contract-view, event, and transaction queries.
  - `wallet/` — write methods (`sendTransaction`).
- `src/transaction/` — transaction build, serialize, and sign helpers.
- `src/contract/` — reusable codecs, typed method and event descriptors, fixed-length values, and contract spec helpers.
- `src/contracts/` — generated standard contract bindings exported through `@groundhogchain/client/contracts`.
- `src/transport/` — `HttpTransport` (JSON-RPC over HTTP) and `MockTransport` for tests.
- `src/signers/` — `Signer` interface and `PrivateKeySigner` (ed25519 via `@noble/ed25519`).
- `src/signedOp/` — off-chain signing of `SignedOp` operations: preimage construction and payload binding, plus the generated `SignedOp` binding re-exported from `src/contracts/signed_op.ts`.
- `src/local-dev/` — Node.js-only local runtime discovery and deterministic bootstrap signer loading.
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/openrpc.json` — pinned Groundhog OpenRPC spec; `scripts/regen-openrpc.sh` refreshes it. After a regen, `npm test` (specifically `src/actions/contract.test.ts`) names any TS action whose serialized request no longer matches the new spec.
- `docs/` — implementation specifications and generated API documentation.

## Subpath exports

The package exposes focused entry points alongside the root: `./transaction`,
`./transport`, `./contract`, `./contracts`, `./signers`, `./actions`,
`./signed-op`, `./wallet`, `./provider`, and the Node.js-only `./local-dev` helper.

Browser wallets use the framework-neutral [wallet provider contract](https://docs.groundhog.dev/tools/wallet-provider/). See [Wallet Integration](https://docs.groundhog.dev/tools/wallet-integration/) for discovery, connection, and the prepare/sign/persist/submit flow.
`./provider` exports wire types, strict validation, and multi-wallet discovery.
`./wallet` exports the existing local-signer wallet API and
`createProviderWalletClient`, with separate prepare, sign, and submit steps so apps
can persist the canonical transaction hash before requesting broadcast.

### Atomic batches with an external wallet

Providers can advertise `supportedMethods: ["getCapabilities"]` alongside
`info`, `request`, and `on`. This leaves existing session and identity objects
unchanged. Older SDKs ignore the optional discovery field. Without it, new SDKs
use legacy single-call behavior without sending an unknown request to the bridge.

`getCapabilities` takes `{ account, networkHash }` and returns the same scope
plus `atomicBatch: { maxCalls }`, or `atomicBatch: null` when unsupported.
The current DefaultWallet limit is 16 calls. The provider must verify origin,
account, and network authorization without prompting. Error 4200 also means
unsupported; other failures and malformed responses remain errors.

An external `ProviderWalletClient` exposes `getCapabilities()` and
`prepareBatchExecution({ invocations, gasLimit, ...transactionOptions })`.
The adapter rechecks the session and capability limit when preparing a batch.
It creates one root DefaultWallet execution and copies the ordered call inputs
before asynchronous work. Each call has its own gas limit; the root budget must
cover the calls and wallet overhead.

Use the existing sign, persist, and submit sequence for the resulting transaction.
Decode the root receipt with `DefaultWallet.v0_1.execute.decodeReceipt(receipt)`;
its `value` contains one return payload per call, in order. Decode each payload
with that call's generated `decodeReturn` method. A failed inner call rolls back
the batch. A successfully enqueued request can still fail during later queue
processing, which is a separate transaction and outcome.

Choose legacy execution before signing when batching is unsupported. Never turn
a rejection or uncertain batch submission into automatic individual retries.
Recover an uncertain submission through its original saved transaction hash.

## Documentation

- [TypeScript SDK guide](https://docs.groundhog.dev/tools/typescript-sdk/) and the
  [end-to-end tutorial](https://docs.groundhog.dev/tutorials/work-with-groundhog-from-typescript/)
  on the Groundhog developer site.
- [JSON-RPC API reference](https://docs.groundhog.dev/reference/json-rpc-api/) for the
  methods behind each action.
- The TypeDoc API reference is generated from this package's entry points with
  `npm run docs` (see [API docs](#api-docs)).

## API docs

Generate local API reference docs with TypeDoc:

```sh
npm run docs
```

The generated HTML is written to `docs/api/`. That directory is ignored and should not be committed.

To validate that API docs still build without writing output:

```sh
npm run docs:check
```

The API reference is generated from the package's public entry points, matching the root and subpath exports listed above.

## Developing

### Registry auth (one-time setup)

The `@groundhogchain/*` dependencies are hosted on GitHub Packages, which
requires a GitHub token even to download — a plain `npm install` on a fresh
machine fails with `401 Unauthorized` from `npm.pkg.github.com`. To set up
auth using the `gh` CLI:

```sh
# Add the read:packages scope to your gh login (one-time, opens github.com)
gh auth refresh -h github.com -s read:packages
```

Then add this line to `~/.npmrc` (it holds no secret — npm expands
`${ENV_VARS}` from the environment; it cannot run commands like
`$(gh auth token)` itself):

```
@groundhogchain:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_NPM_TOKEN}
```

And run installs with the token pulled from gh's keychain:

```sh
GH_NPM_TOKEN="$(gh auth token)" npm install
```

If you forget the prefix, npm fails with `Failed to replace env in config` —
that's your reminder.

## Scripts

- `npm run build` — bundle ESM, CommonJS, source maps, and declarations with `tsdown`.
- `npm test` / `npm run test:watch` — run `vitest`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test:package-boundary` — compile a consumer fixture against the built package declarations.
- `npm run test:smoke` — load every built package entrypoint as ESM and CommonJS.
- `npm run test:integration` — build the package and test it against an isolated real local node (Linux).
- `npm run contracts:generate` — regenerate all checked-in contract bindings from pinned specs.
- `npm run contracts:check` — verify generated bindings match their pinned specs and generator.
- `npm run docs` — generate TypeDoc API reference HTML in `docs/api/`.
- `npm run docs:check` — validate TypeDoc generation without writing output.
- `npm run format` / `format:check` — `prettier`.

### Live integration tests

On Linux with Node 24, install the CLI version pinned in
[`scripts/integration-versions.json`](scripts/integration-versions.json), then run:

```sh
npm run test:integration
# Or select an explicit CLI executable:
GROUNDHOG_CLI=/path/to/groundhog npm run test:integration
```

The harness installs the pinned devnode through the CLI’s checksum-verified
runtime catalog. It checks that the executable runs and starts a fresh node on an OS-assigned
loopback port. The host must provide the devnode's native runtime libraries;
CI uses the same Ubuntu 26.04 Namespace profile as the RPC repository. Tests
import the built package and check connection, local funding, a HOG transfer, receipts,
events, contract views, and RPC errors. `npm test` remains node-independent.

The harness isolates configuration and state, stops its child processes, and
retains logs and node state on failure at the printed temporary path. Set
`GROUNDHOG_INTEGRATION_LOG_DIR` to retain logs at a chosen location; CI uploads
them as `live-node-logs`.

The pinned devnode supports unified native deployment. The standard integration
run requires atomic funding, deployment, initialization and state readback to
pass. To qualify another matching runtime, start a disposable node and run the
built package tests against its reported URL and manifest:

```sh
npm run build
GROUNDHOG_RPC_URL=http://127.0.0.1:9545 \
GROUNDHOG_RUNTIME_MANIFEST=/absolute/path/to/runtime-manifest.json \
node --test --test-concurrency=1 tests/integration/live-node.test.mjs
```

The tests do not perform capability discovery or fall back on unsupported runtimes.
