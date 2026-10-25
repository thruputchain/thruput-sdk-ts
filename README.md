# @thruputchain/client

TypeScript client for the [Thruput](https://github.com/groundhogchain) blockchain.

It provides typed JSON-RPC actions, transaction construction and signing,
HTTP and mock transports, and generated contract bindings. Generated methods
share one descriptor API for invocations, typed views, root-receipt decoding,
returns, and contract exceptions. Generated events provide strict decoding,
named topic filters, and receipt extraction.

## Install

```sh
npm install @thruputchain/client
```

The package is currently distributed through GitHub Packages and requires a
token with `read:packages`. See [Registry auth](#registry-auth-one-time-setup).

## Usage

This checkout pins RPC wire format **14.1.1**. Block queries require a compatible
RPC server and a node with the block-query index. RPC addresses, public keys,
validator IDs and hashes use unprefixed, case-sensitive base58. Opaque payloads
(including signed transactions, calldata, return data, storage keys, raw event
topics) retain `0x`-prefixed hex. Cursors are opaque strings, preserved unchanged.
Methods accept and return
typed byte arrays; they apply the encoding at the transport boundary.

All 64-bit and wider integers
are canonical decimal strings in JSON and `bigint` in the client API, including
heights, nanosecond timestamps, gas, mempool counts, wide server limits, and
airdrop retry intervals. Smaller bounded fields, such as page limits and event
sequence numbers, remain JSON numbers. Numeric JSON for wide fields is rejected,
even when the value is small. Live qualification requires a matching wire-14
CLI and runtime.

Pass heights as `bigint` (for example, `42n`). The actions serialize them as
decimal strings and validate protocol bounds. When persisting client results,
convert bigint fields explicitly to decimal strings; `JSON.stringify` does not
serialize bigint values by itself.

```ts
import { createThruputClient, HttpTransport } from "@thruputchain/client";

const client = await createThruputClient({
  transport: new HttpTransport("https://rpc.example.com"),
});

const tip = await client.getChainTip();
const { transactionHash } = await client.sendTransaction({ signedTransaction });
```

### Read a committed block

```ts
const blockHeight = 42n;
const block = await client.getBlockByHeight({ blockHeight });
if (block !== null) {
  for await (const page of client.iterateTransactionsByBlock({
    blockHeight,
    start: { order: "ascending" },
    limit: 50,
  })) {
    console.log(page.transactions);
  }
}
```

References use unsigned hash order, not execution order. The walker checks
coverage for the target block, preserves the opaque cursor and rejects duplicate
or out-of-order rows. Completion covers that block only. A missing block returns
`null`; backend failures remain errors. Invalid cursors never restart the walk.
All reads accept `{ signal }` as the final argument.

Enable HTTP batching to group concurrent calls into one JSON-RPC array:

```ts
const client = await createThruputClient({
  transport: new HttpTransport("https://rpc.example.com", {
    batch: true, // defaults to { maxSize: 100, waitMs: 0 }
  }),
});

const [tip, version] = await Promise.all([
  client.getChainTip(),
  client.getVersionInfo(),
]);
```

Batching is opt-in and requires an endpoint that accepts JSON-RPC arrays.
It reduces HTTP requests but does not guarantee a shared snapshot, execution
order, or atomicity. Await dependent calls separately. See `HttpTransportOptions`
in the API reference for timeout, cancellation, and error behavior.

Pass a cluster to fetch the endpoint's network identity during connection and
verify it against the cluster's `networkHash`, if supplied:

```ts
import { createThruputClient, devnet, toBase58 } from "@thruputchain/client";

const client = await createThruputClient({
  cluster: devnet(),
});

console.log(toBase58(client.network.networkHash));
```

`devnet()` uses `https://rpc.thruput.network`. Applications with an explicit
`rpcUrl`, `HttpTransport` URL, or environment configuration should update that
value to use the stable endpoint; upgrading the package preserves overrides.

Development clusters expose a typed airdrop action. It generates a
client nonce, calls the faucet once, then uses read-only status and receipt polling
when a pending response identifies a transaction:

```ts
const airdrop = await client.requestAirdrop({ recipient: accountAddress });
console.log(airdrop.transactionHash, airdrop.rawAmount);
```

Remote airdrops retain the faucet's per-recipient cooldown and share the
gateway's configured aggregate quota. Localnet has no hosted cooldown, but its
funding journal retains at most 1024 attempts per chain across `requestAirdrop`
and `dev_fundAccount`. It rejects new requests at capacity and keeps existing requests
available for reconciliation. The generated nonce is not persisted. For crash
recovery, generate and persist `clientNonce`, recipient and network hash before
calling `requestAirdrop({ recipient, clientNonce })`. Use `requestAirdropAttempt`
to control read-only observation yourself. Faucet errors and pending responses
without a transaction hash stop immediately. The SDK never repeats the faucet request.

The predefined clusters are `mainnet`, `devnet`, and `localnet`. Declare a
deployment-specific cluster inline, or use `defineCluster` when the descriptor
will be reused. Devnet and localnet include default RPC URLs; pass `rpcUrl` to
override them. Mainnet has no default endpoint yet. Supply a `networkHash` when
the application must pin the protocol identity used for transaction signing.
`devnet()` is unpinned by default; use `devnet({ networkHash })` to pin it.
Identity is checked at connection, not continuously after network resets.
Pass an explicit transport for custom headers or request handling. Omit
`cluster` to discover an endpoint without pinning a particular network. Both forms
validate wire 14 and advertised methods; declared capabilities must be advertised.

```ts
const client = await createThruputClient({
  cluster: {
    name: "private-devnet",
    rpcUrl: "https://rpc.example.com",
    capabilities: ["airdrop"],
  },
});
```

Common protocol types and constructors are available directly from
`@thruputchain/client`: addresses, hashes, block heights, gas amounts,
`ContractEntrypointID`, `Calldata`, `TimePoint`, and `InvokeFlagSet`. The client also
exports `Invocation`, `Transaction`, `SignedTransaction`, `InvokeFlag`, and
`ExecResult`. These are the original protocol definitions; the full protocol and
XDR API remains available from `@thruputchain/protocol`.

```ts
import { gasAmount, type ContractAddress } from "@thruputchain/client";
```

Generated contract bindings are exported separately. Each interface nests its
methods and their argument, result, and exception types under the major version
its entrypoints hash (`ERC20.v0_1.transfer`, `ERC20.v0_1.TransferArgs`); named
types, enum values, and event descriptors nest under the declaring crate and
major (`thruput_erc20_if.v0_1.events.TransferEvent`).

```ts
import { ERC20 } from "@thruputchain/client/contracts";

const balance = await ERC20.v0_1.getBalanceOf.view({
  client,
  address: tokenAddress,
  args: { addr: accountAddress },
});

const transfer = ERC20.v0_1.transfer.invocation(tokenAddress, gasLimit, {
  receiver: recipientAddress,
  amount: 1_000n,
});
```

### Exact amounts

Convert user input without floating-point arithmetic:

```ts
import { parseUnits, formatUnits } from "@thruputchain/client";

const amount = parseUnits("12.05", 2); // 1205n
console.log(formatUnits(amount, 2)); // "12.05"
```

Parsing rejects malformed input and excess precision rather than rounding.
Applications still check token positivity and size limits. See the
[amount guide](https://docs.thruput.network/tools/typescript-sdk/#exact-amounts-and-common-types)
for error handling and supported inputs.

### Cancellable reads

Pass request options to public actions and put `signal` inside generated view options:

```ts
const controller = new AbortController();
const { signal } = controller;
const tip = await client.getChainTip({ signal });
const balance = await ERC20.v0_1.getBalanceOf.view({
  client,
  address: tokenAddress,
  args: { addr: accountAddress },
  signal,
});
```

Call `controller.abort()` from the application's cleanup handler. Bound views also
accept a signal. `classifyReadError(error, { signal })` helps distinguish cancellation
from infrastructure failures; applications own retry policy. Canceling observation
does not cancel a transaction. See [read errors](https://docs.thruput.network/tools/typescript-sdk/#cancellation-and-read-errors).

### Inspect arguments

Use the descriptor for the known method to decode calldata:

```ts
const { receiver, amount } = ERC20.v0_1.transfer.decodeArgs(transfer.calldata);
```

`decodeArgs` returns typed arguments and rejects incomplete or trailing bytes.
It returns `undefined` for methods without arguments. Decoding does not verify the
target contract's behavior.

### Release diagnostics

```ts
const version = await client.getVersionInfo();
console.log(
  version.wireFormat,
  version.releaseVersion,
  version.bundleManifestDigest,
);
```

Release identity and bundle digest can be omitted;
they help diagnose installations. Use `wireFormat` for RPC compatibility decisions.

### Read after confirmation

Use the height from a successful receipt as a freshness floor for a single read:

```ts
const balance = await ERC20.v0_1.getBalanceOf.view({
  client,
  address: tokenAddress,
  args: { addr: accountAddress },
  minStateBlockHeight: receipt.blockHeight,
});
```

This requires a matching RPC wire format 14.1.1 endpoint and also works with `.viewOutcome()`, bound
views, and raw `client.simulateInvocation()`. The result must come from a committed snapshot at
or above that height. An older snapshot produces `stateHeightUnavailable`
(`NativeRpcErrorCode.StateHeightUnavailable`, `-32012`) with requested and observed heights. It does not undo transaction
confirmation. The SDK does not poll, wait, or retry; your application decides how
to handle a backend that is behind. Omit `minStateBlockHeight` for an unconstrained read.

### Simulated authorization

Generated `.view()`, `.viewOutcome()` and `.viewRequest()` accept an optional
protocol `AuthClaim` as `assumedAuth`, including `account.authClaim`. The descriptor
converts it to the native typed request. Raw `simulateInvocation` accepts the
native `RpcAssumedAuth` object. Simulation assumes authorization; it does not verify
signatures or persist writes. Contract permission checks still run.

`caller` supplies a parent address. To simulate a root DefaultWallet invocation,
use the wallet's `address`, supply its matching `assumedAuth`, and omit `caller`.
Batch entries are independent invocations against the same state snapshot.

### Reads at one snapshot

Use `readViews` when several contract reads must use the same committed state:

```ts
const snapshot = await client.readViews({
  calls: [
    ERC20.v0_1.totalSupply.viewRequest({ address: tokenAddress }),
    ERC20.v0_1.getBalanceOf.viewRequest({
      address: tokenAddress,
      args: { addr: accountAddress },
    }),
  ],
  minStateBlockHeight: receipt.blockHeight,
});

const [supply, balance] = snapshot.results;
if (supply.kind === "return" && balance.kind === "return") {
  console.log(snapshot.stateBlockHeight, supply.value, balance.value);
}
```

Each tuple position retains its generated return and exception types. Results are
`return`, `abort`, or `fault`, with events. Simulated writes stay within each call.
Omit `minStateBlockHeight` if no freshness floor is needed. If the selected snapshot is
behind, the server returns `stateHeightUnavailable` with requested and observed
heights. The request neither waits for a block nor forces a refresh; your
application decides whether and when to retry.

This requires `simulateInvocations` (RPC wire format 14.1.1). Existing generated
bindings gain `viewRequest` through the runtime. The low-level API is
`client.simulateInvocations({ invocations, minStateBlockHeight })`. Neither API splits calls or falls back
to separate views. HTTP transport batching alone does not share snapshots.

Operators set batch limits; inspect `(await client.getServerLimits()).simulationBatch`
when you need the endpoint's policy. Per-call view and transport limits also
apply. The server retries an abandoned snapshot as a whole group, at most three
times. Its configured deadline bounds the response wait, but running backend
work can outlive it. Pass `{ signal }` as the second argument to cancel the
client's wait.

### Event and sender history

```ts
import { thruput_erc20_if } from "@thruputchain/client/contracts";
const { TransferEvent } = thruput_erc20_if.v0_1.events;
const page = await client.getContractEvents({
  event: TransferEvent,
  addresses: [tokenAddress],
  topics: { to: accountAddress },
  start: { order: "ascending", anchor: { kind: "atBeginning" } },
  limit: 20,
});
for (const transfer of page.events) {
  console.log(
    transfer.transactionHash,
    transfer.blockHeight,
    transfer.fields.amount,
  );
}
```

This makes one request. To continue, repeat filters and pass `cursor: page.nextCursor`
without `start`. Stop at `nextCursor: null`; an empty page can still have a cursor.
Typed event filters convert address topics to the token's fixed-byte representation.
`getTransactionsByRootAddress` returns transactions sent by the root address;
incoming transfers use the token's Transfer event.

`iterateEventPages` and `iterateTransactionsByRootAddress` start an explicit range
and retain its initial upper watermark W. They reject regressed coverage, duplicate
identities, out-of-order rows and cursor cycles. No retries, prefetching or silent
restart occur. Cursor-only continuation remains available on the raw RPC methods.

A range generator returns `HistoryCompletion` only when resumed after the terminal
page has been processed. For ascending walks, `completedThroughBlockHeight` is W;
it is absent if the starting height was above W. Descending completion is not an
ingestion checkpoint. Persist processed rows and the checkpoint together. Start the
next ascending range inclusively at W and deduplicate the boundary. Page bounds
are serving availability, not processed checkpoints. No cross-reset durability is
implied. Breaking or cancelling a walk produces no completed checkpoint.

`for await` discards a generator's return value. Use `.next()` when you need
`HistoryCompletion`; `processPage` below is your application's durable processing:

```ts
const pages = client.iterateEventPages({
  filters: [{ addresses: [tokenAddress] }],
  start: {
    order: "ascending",
    anchor: { kind: "atHeight", blockHeight: fromHeight },
  },
});
let completion;
for (;;) {
  const step = await pages.next();
  if (step.done) {
    completion = step.value;
    break;
  }
  await processPage(step.value);
}
```

Walkers retain seen identities and cursors, so memory grows with rows and pages.
Start near your saved checkpoint; use per-block transaction walks for large
transaction backfills. A page limit bounds each response, not the whole walk.

Local applications own their signing keys. A schema-4 local manifest contains
public allocations and a public faucet address; it cannot produce a signer.
Use `Ed25519Signer` with `createPubkeyAccount`, then request an airdrop or
supply its public key in the node's initial allocations. Stored CLI keys can be
exported explicitly through `thruput keys export`; never log that output.

## Native RPC client

`createRpcClient` exposes the native wire-14 methods directly. It validates the
wire version, configured methods and optional expected network before returning.
Requests use byte arrays and bigints; cursors remain opaque strings.

```ts
import { createRpcClient, HttpTransport } from "@thruputchain/client";

const rpc = await createRpcClient({
  transport: new HttpTransport("http://127.0.0.1:9545"),
  requiredMethods: ["getChainTip", "getBalance"],
});
const tip = await rpc.getChainTip();
const balance = await rpc.getBalance({ address: accountAddress });
```

Each method makes one RPC call. There are no retries, transaction signing or
receipt waits in this layer. Unknown response variants retain their original
payload in `UnsupportedRpcValue`; malformed known results throw
`RpcDecodingError`. Invalid local inputs throw `RpcRequestValidationError`
before dispatch. `NativeRpcError.decoded` distinguishes known, valid evidence
from unclassified errors; both retain the complete raw error. Neither classification
authorizes retries. Transaction evidence is compared with the requested hash.
Malformed HTTP reply envelopes throw `RpcResponseError` with the raw reply.
`refreshDiscovery()` performs only discovery reads and never replays writes.

## Wallet clients

A wallet client binds account authorization and signers to an existing client:

```ts
import {
  createThruputClient,
  createPubkeyAccount,
  createWalletClient,
  devnet,
  Ed25519Signer,
} from "@thruputchain/client";

const client = await createThruputClient({ cluster: devnet() });
const signer = Ed25519Signer.fromSeed(secretKey);
const account = createPubkeyAccount({ signer, nonce: 0n });
const wallet = createWalletClient({ client, account });

await wallet.requestAirdrop();
const balance = await wallet.getBalance();
```

For local funding with an explicit raw amount, call `client.dev_fundAccount` once. Persist the request, network hash and public
faucet address before sending. An uncertain response does not authorize a repeat. The response carries
the admitted hash and exact signed bytes. Wait for a receipt to learn execution.
`requestAirdrop` retains its fixed amount and hosted behavior.

Pubkey accounts can also be authorized by an ML-DSA-65 (FIPS 204) key. The
account address commits to a hash of the scheme-tagged key, and each signed
transaction carries the key itself, so signatures and keys are larger
(3,309 and 1,952 bytes) but the flow is the same:

```ts
import { MlDsa65Signer, createPubkeyAccount } from "@thruputchain/client";

const signer = MlDsa65Signer.fromSeed(seed); // 32-byte seed
const account = createPubkeyAccount({ signer, nonce: 0n });
```

ML-DSA keys have no StrKey (`G...`/`S...`) form; those encodings remain
Ed25519-only.

Both built-in signers implement the same `Signer` interface and are created
the same way, with `Ed25519Signer.fromSeed` or `MlDsa65Signer.fromSeed`.

Use `createSourceAddressAccount` with the appropriate invocation adapter for
an existing account contract. Saved legacy contract-wallet identities remain
separate from the native bootstrap accounts.

Wallet clients prepare fresh transaction expiry and replay nonces, sign with
the account's configured signers, and submit transactions. Pubkey accounts use
the native-compatible DefaultWallet adapter automatically. The signing network
comes from a cluster-validated client's `networkHash`.
When binding an unqualified client, pass an explicit `networkHash` to
`createWalletClient`.

Choose a workload-specific root gas budget: it reserves scheduling capacity
against the sender's free native-token balance even though gas is not burned.
New storage also needs native-token deposits at the address that owns it. See
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
import { prepareContractDeployment } from "@thruputchain/client/wallet";
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

`amount` is a raw native-token amount, chosen by the caller; `0n` skips the
transfer. The target's existing balance plus this amount must cover deployment
and initialized storage.
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
const { transactionHash: submittedHash } = await wallet.sendTransaction({
  signedTransaction: serializeSignedTransaction(signed),
});

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
against the sender's free native-token balance. Funding a target contract's
storage does not fund the sender's capacity. Use measured budgets for each workload; `walletGasLimit`
sums explicit child budgets and a calibrated overhead, without estimating gas.

A new native-token balance item needs a deposit at the recipient address. A
large enough first credit can fund it; a small credit can be excluded with a scheduler
`retry` outcome. The transfer example funds both accounts first
because its 1,000-unit credit cannot cover a new balance item's deposit.

The live funding test verifies an excluded 1,000-unit first credit, a successful
100,000-unit first credit with a deposit deduction, and a later 1,000-unit credit
without another balance-item deposit. It uses 500,000 child gas and 1,000,000 root
gas. Storage costs depend on runtime configuration.

A deployed contract's storage needs native tokens at its address too. The
native deployment API above transfers the explicit `amount` before deploying and optionally
initializing the contract in the same transaction. Size that amount for the code
and initialized storage, and budget root gas for the complete operation.

The standard ERC20 binding uses `adjustAllowance` with
`{ spender, difference }`, not `approve`. `difference` is signed: positive
increases the allowance, negative reduces it. Adjustments may merge with
concurrent spending and adjustments, so reading the current allowance and
submitting a delta cannot guarantee an exact target. To set an absolute
allowance, call `deleteAllowance({ spender })` and then `adjustAllowance` in
the same transaction: the delete's exclusive lock covers the following write,
so a concurrent change conflicts instead of interleaving. That lock does not
make an earlier off-chain read current. Interface 0.1.68 removed
`adjustAllowance`'s `exclusive` flag in favor of this pattern.
`deleteAllowance({ spender })` revokes an allowance, deletes its storage
entry, and emits `AllowanceDeleteEvent` with the stored amount removed.
`deleteBalance()` deletes the caller's empty balance entry and throws for a
nonzero balance. Allowance changes emit `AllowanceChangeEvent` with the signed
`difference`. Interface 0.1.68 has no `burn` method or `BurnEvent`, and amounts
are signed 128-bit integers in `0..=i128::MAX`.

A receipt proves commitment; inspect its `execution.result`. A `committed`
status always includes `blockHeight`, even when the receipt is not indexed yet.
`pending`, `retry`, and `dropped` can include a best-effort `recentFailure`
diagnostic with an `attemptBlockHeight` and `cause`. It may describe an earlier
attempt, not the scheduler's current attempt. The standalone `recentFailure`
status reports that diagnostic when the scheduler has no retained status.

The observer reports statuses through `onStatus` and retains them on timeout.
Once commitment is observed, later scheduler statuses cannot erase it. Failed
attempts, timeout, and cancellation do not prove nonexecution or permit automatic
resubmission. Preserve signed evidence and resume observing the original hash
instead of automatically re-signing.

## Signed operations

A signed operation authorizes an on-chain action off-chain: the signer signs a
`#[contract_type]` payload together with the network, the verifying contract,
and a replay guard (a signer-chosen nonce plus an expiry height), and anyone
can submit it. The contract verifies it with the `thruput-signed-op` Rust
component against the key it holds; nothing on the wire names the signer. The
`@thruputchain/client/signed-op` entrypoint is the client half.

```ts
import {
  defineSignedOperation,
  randomNonce,
} from "@thruputchain/client/signed-op";
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

- [`chain-tip.ts`](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/chain-tip.ts) connects to Devnet and reads its latest block.
- [`transfer-native-token.ts`](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/transfer-native-token.ts) funds two pubkey accounts and transfers native tokens on Devnet.
- [`view-native-token-balance.ts`](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/view-native-token-balance.ts) reads an explicitly supplied public account’s native-token balance.
- [`deploy-counter.ts`](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/deploy-counter.ts) deploys and calls a Counter contract through DevWallet.

See the [examples guide](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/README.md) for local-node setup and configuration.

Use the root entrypoint for the client and common runtime APIs. Focused
entrypoints are available for transactions, transports, contract runtime
helpers, generated standard contracts, signers, and standalone actions.

## What's in this repo

- `src/client.ts` — async `createThruputClient` factory for unqualified and cluster-validated clients.
- `src/actions/` — RPC actions grouped by namespace:
  - `public/` — chain, account, contract-view, event, and transaction queries.
  - `wallet/` — write methods (`sendTransaction`).
- `src/transaction/` — transaction build, serialize, and sign helpers.
- `src/contract/` — reusable codecs, typed method and event descriptors, fixed-length values, and contract spec helpers.
- `src/contracts/` — generated standard contract bindings exported through `@thruputchain/client/contracts`.
- `src/transport/` — `HttpTransport` (JSON-RPC over HTTP) and `MockTransport` for tests.
- `src/signers/` — `Signer` interface, `Ed25519Signer` (ed25519 via `@noble/ed25519`), and `MlDsa65Signer` (ML-DSA-65 via `@noble/post-quantum`).
- `src/signedOp/` — off-chain signing of `SignedOp` operations: preimage construction and payload binding, plus the generated `SignedOp` binding re-exported from `src/contracts/signed_op.ts`.
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/native-openrpc.json` — Rust-owned native OpenRPC snapshot; `scripts/regen-openrpc.sh` refreshes it with recorded provenance. `npm run rpc:check` verifies generated codecs and types; `src/rpc/client.test.ts` checks every method’s named params and results.
- `docs/api/` — generated TypeDoc output from `npm run docs` (ignored by git; see [API docs](#api-docs)).
- `Caddyfile` and `Staticfile` — configure the private TypeDoc host that serves `docs/api/`; they are not part of the published package.

## Subpath exports

The package exposes focused entry points alongside the root: `./transaction`,
`./transport`, `./contract`, `./contracts`, `./signers`, `./actions`,
`./signed-op`, `./wallet`, and `./provider`.

Browser wallets use the framework-neutral [wallet provider contract](https://docs.thruput.network/tools/wallet-provider/). See [Wallet Integration](https://docs.thruput.network/tools/wallet-integration/) for discovery, connection, and the prepare/sign/persist/submit flow.
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

- [TypeScript SDK guide](https://docs.thruput.network/tools/typescript-sdk/) and the
  [end-to-end tutorial](https://docs.thruput.network/tutorials/work-with-groundhog-from-typescript/)
  on the Thruput developer site.
- [JSON-RPC API reference](https://docs.thruput.network/reference/json-rpc-api/) for the
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

The `@thruputchain/*` dependencies are hosted on GitHub Packages, which
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
@thruputchain:registry=https://npm.pkg.github.com
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
- `npm run test:integration:cli-transfer` — build the package and read back a CLI transfer from an existing node.
- `npm run contracts:generate` — regenerate all checked-in contract bindings from pinned specs.
- `npm run contracts:check` — verify generated bindings match their pinned specs and generator.
- `npm run docs` — generate TypeDoc API reference HTML in `docs/api/`.
- `npm run docs:check` — validate TypeDoc generation without writing output.
- `npm run format` / `format:check` — `prettier`.

### Live integration tests

The wallet provider contract is now version `2.0.0`. Account addresses, public
keys, network hashes and transaction hashes use case-sensitive, unprefixed
base58. Transaction and signed-transaction XDR remain canonical `0x` hex,
with binary signatures intact.

Run on Linux with Node 24. CI installs the published CLI crate and public devnode
artifact pinned in
[`scripts/integration-versions.json`](scripts/integration-versions.json): CLI
0.39.0, devnode 0.1.31-rc.16 and wire 14.1.1. CI qualification uses the crate-built
CLI; it does not verify a packaged CLI bundle. Locally, install that CLI version on
`PATH` or set `THRUPUT_CLI` to its executable. The harness installs the pinned
devnode when no runtime override is supplied.

```sh
npm run test:integration
```

The harness checks that the executable runs and starts a fresh node on an OS-assigned
loopback port. The host must provide the devnode's native runtime libraries;
CI uses the same Ubuntu 26.04 Namespace profile as the RPC repository. Tests
import the built package and check connection, local funding, a native-token
transfer, receipts, events, contract views, and RPC errors. `npm test` remains node-independent.

The tools smoke harness can also create a transfer and run the SDK readback
check against its existing node:

```sh
THRUPUT_CLI_TRANSFER_RESULT=/absolute/path/to/result.json npm run test:integration:cli-transfer
```

This command reads the harness's transfer evidence and checks the receipt,
event, balance and network identity. The tools harness owns the node lifecycle;
the normal integration command always starts its own node and runs its suite.

The transfer workflow also checks grouped reads and view freshness, an
authenticated wallet simulation, and recovery of admitted local-funding bytes
after a lost response. This profile requires wire 14.1.1, base58 identifiers
and ML-DSA-65 pubkey accounts.

An explicit `THRUPUT_CLI` must match the configured version and any configured
source pin. The harness verifies the serving RPC version and wire version, and
checks source identity when a source pin is configured.
For an unpinned local candidate, set `THRUPUT_ALLOW_LOCAL_CANDIDATE=1` together
with `THRUPUT_CLI`. Runtime, wire and protocol overrides also require this mode;
CI rejects them. An explicit devnode skips runtime installation. Use
`HOGD_PROTOCOL_OVERRIDE` only for a compatible runtime with a different handshake
token. Qualification logs record these deviations.

The harness isolates configuration and state, stops its child processes, and
retains logs and node state on failure at the printed temporary path. Set
`THRUPUT_INTEGRATION_LOG_DIR` to retain logs at a chosen location; CI uploads
them as `live-node-logs`.

The matching devnode must support unified native deployment. The standard integration
run requires atomic funding, deployment, initialization and state readback to
pass. To qualify another matching runtime, start a disposable node and run the
built package tests against its reported URL and manifest:

```sh
npm run build
THRUPUT_RPC_URL=http://127.0.0.1:9545 \
THRUPUT_RUNTIME_MANIFEST=/absolute/path/to/runtime-manifest.json \
node --test --test-concurrency=1 tests/integration/live-node.test.mjs
```

Client creation checks network identity, wire version and supported methods.
The tests fail on unsupported runtimes; they do not fall back.

Block-query qualification uses the same CLI and runtime pins.
It starts an isolated interval-driven node, submits known
transactions, compares both page orders with their receipts, checks empty blocks,
parent linkage and the canonical tip hash, and rejects zero limits:

```sh
npm run test:integration:blocks
```

Use the same optional `HOGD_PROTOCOL_OVERRIDE` rule as above. This profile requires
wire 14.1.1 and fails on unsupported nodes. The final native tools/runtime artifact
set must pass both profiles before this SDK is released. Unit tests do not qualify
a live node. `scripts/regen-openrpc.sh` imports a reviewed Rust-generated wire-14
snapshot or generator via explicit source path and commit; it does not install an
older released generator.

For local funding recovery, retain the original request before sending it.
A known `localFundingUnresolved` error can preserve `transactionHash` and exact
`signedTransaction` evidence. Inspect the hash through read-only status/receipt
calls. Neither an uncertain response nor a later rejection authorizes a new nonce,
replacement transaction or automatic funding repeat.

## Publishing the renamed packages

The `@thruputchain/*` packages publish to GitHub Packages from repositories in
`thruputchain`. Release workflows use the repository's `GITHUB_TOKEN` with
`packages: write`.

Publish the protocol packages first, then the client, then React. Grant the
client and React repositories Actions read access to the protocol packages,
and grant React read access to the client package. Refresh downstream lockfiles
from the published artifacts before merging their PRs.

Existing `@groundhogchain/*` releases retain their original identities.
