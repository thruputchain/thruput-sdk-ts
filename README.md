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

This checkout pins RPC wire format **13.0.0**. Block queries require a compatible
RPC server and a node with the block-query index. RPC addresses, public keys,
validator IDs and hashes use unprefixed, case-sensitive base58. Opaque payloads
(including signed transactions, calldata, return data, storage keys, raw event
topics and cursors) retain `0x`-prefixed hex. Actions continue to accept and return
typed byte arrays; they apply the encoding at the transport boundary.

All 64-bit and wider integers
are canonical decimal strings in JSON and `bigint` in the client API, including
heights, nanosecond timestamps, gas, mempool counts, wide server limits, and
airdrop retry intervals. Smaller bounded fields, such as page limits and event
sequence numbers, remain JSON numbers. Numeric JSON for wide fields is rejected,
even when the value is small. The pinned integration runtime supports block
queries and uses the same wire format.

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
const txHash = await client.sendTransaction(signedTransaction);
```

### Read a committed block

```ts
import { toHex0x } from "@thruputchain/client";

const height = 42n;
const block = await client.getBlockByNumber(height);
if (block !== null) {
  let cursor: Uint8Array = new Uint8Array();
  const seen = new Set<string>();
  do {
    const page = await client.getTransactionsByBlock({
      height,
      order: "ascending",
      cursor,
      limit: 50,
    });
    if (page.cursor.length !== 0) {
      const next = toHex0x(page.cursor);
      if (seen.has(next)) throw new Error("Repeated block pagination cursor");
      seen.add(next);
    }
    console.log(page.refs); // transaction hashes and bigint heights
    cursor = page.cursor;
  } while (cursor.length !== 0);
}
```

References use unsigned hash order, not execution order. Keep the height and
opaque cursor unchanged when continuing. Omitted limits send 50; explicit limits
must be 1–200 and must respect the endpoint's `getServerLimits()` cap. Zero is
invalid. Coverage starts at 1 and can lag behind the chain tip; genesis metadata
is unavailable. Block lookup returns `null` outside coverage. An empty reference
page alone does not prove an empty block. Backend failures remain errors.

Malformed or stale cursors currently return empty terminal pages. A matching
continuation above a lagging index's tip reports unavailable; retry after that
index catches up. Both actions accept `{ signal }` for cancellation.

Enable HTTP batching to group concurrent calls into one JSON-RPC array:

```ts
const client = await createThruputClient({
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
import { createThruputClient, devnet, toBase58 } from "@thruputchain/client";

const client = await createThruputClient({
  cluster: devnet(),
});

console.log(toBase58(client.network.networkHash));
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
gateway's configured aggregate quota. Localnet has no hosted cooldown, but its
funding journal retains at most 1024 attempts per chain across `requestAirdrop`
and `fundAccount`. It rejects new requests at capacity and keeps existing requests
available for reconciliation. Use
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
major (`groundhog_erc20_if.v0_1.events.TransferEvent`).

```ts
import { ERC20 } from "@thruputchain/client/contracts";

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
  contract: tokenAddress,
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
const version = await client.getVersion();
console.log(
  version.wireFormat,
  version.releaseVersion,
  version.bundleManifestDigest,
);
```

Release identity and bundle digest can be `null`;
they help diagnose installations. Use `wireFormat` for RPC compatibility decisions.

### Read after confirmation

Use the height from a successful receipt as a freshness floor for a single read:

```ts
const balance = await ERC20.v0_1.getBalanceOf.view({
  client,
  contract: tokenAddress,
  args: { addr: accountAddress },
  minHeight: receipt.height,
});
```

This requires a matching RPC wire format 12 endpoint and also works with `.viewOutcome()`, bound
views, and raw `client.view()`. The result must come from a committed snapshot at
or above that height. An older snapshot produces `ViewHeightUnavailable`
(`-32011`) with requested and observed heights. It does not undo transaction
confirmation. The SDK does not poll, wait, or retry; your application decides how
to handle a backend that is behind. Omit `minHeight` for an unconstrained read.

### Simulated authorization

Views accept an optional protocol `authClaim`, including `account.authClaim` from
an SDK account. It is an assumption for simulation, not verified authorization;
no signature is needed and no writes persist. The invoked contract still runs
its normal permission checks. Omitting the claim keeps the current default.

Pass `authClaim` to `client.view`, generated or bound `.view()` / `.viewOutcome()`,
or `.viewRequest()` for a grouped read. Each `viewBatch` entry has its own claim.
This requires matching RPC (wire 13.0.0) and hogd builds with view auth support.

`caller` is separate: it supplies a parent-contract address. To simulate a root
invocation such as `DefaultWallet.execute`, use the account address as `contract`,
pass its matching `authClaim`, and omit `caller`. Its child calls share state
through normal execution. Different `viewBatch` entries remain independent.

### Reads at one snapshot

Use `readViews` when several contract reads must use the same committed state:

```ts
const snapshot = await client.readViews({
  calls: [
    ERC20.v0_1.totalSupply.viewRequest({ contract: tokenAddress }),
    ERC20.v0_1.getBalanceOf.viewRequest({
      contract: tokenAddress,
      args: { addr: accountAddress },
    }),
  ],
  minHeight: receipt.height,
});

const [supply, balance] = snapshot.results;
if (supply.kind === "return" && balance.kind === "return") {
  console.log(snapshot.height, supply.value, balance.value);
}
```

Each tuple position retains its generated return and exception types. Results are
`return`, `abort`, or `fault`, with events. Simulated writes stay within each call.
Omit `minHeight` if no freshness floor is needed. If the selected snapshot is
behind, the server returns `ViewHeightUnavailable` with requested and observed
heights. The request neither waits for a block nor forces a refresh; your
application decides whether and when to retry.

This requires `groundhog_viewBatch` (RPC wire format 13.0.0). Existing generated
bindings gain `viewRequest` through the runtime. The low-level API is
`client.viewBatch({ calls, minHeight })`. Neither API splits calls or falls back
to separate views. HTTP transport batching alone does not share snapshots.

Operators set batch limits; inspect `(await client.getServerLimits()).viewBatch`
when you need the endpoint's policy. Per-call view and transport limits also
apply. The server retries an abandoned snapshot as a whole group, at most three
times. Its configured deadline bounds the response wait, but running backend
work can outlive it. Pass `{ signal }` as the second argument to cancel the
client's wait.

### Event pages

Use a generated event descriptor to fetch one page with typed topics and fields:

```ts
import { groundhog_erc20_if } from "@thruputchain/client/contracts";

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

A cursor continues one bounded historical walk, not future blocks. For ascending
ingestion, start a new ascending walk with an empty cursor at the last stored
row's height and deduplicate that block. Save rows and progress together. Refresh
descending history from `anchor: "end"` with an empty cursor, not its oldest row.
See the [pagination and restart walkthrough](https://docs.thruput.network/tutorials/add-events-to-a-contract/#resume-without-missing-events).

Local applications own their signing keys. A schema-4 local manifest contains
public allocations and a public faucet address; it cannot produce a signer.
Use `PrivateKeySigner` with `createPubkeyAccount`, then request an airdrop or
supply its public key in the node's initial allocations. Stored CLI keys can be
exported explicitly through `thruput keys export`; never log that output.

## Wallet clients

A wallet client binds account authorization and signers to an existing client:

```ts
import {
  createThruputClient,
  createPubkeyAccount,
  createWalletClient,
  devnet,
  PrivateKeySigner,
} from "@thruputchain/client";

const client = await createThruputClient({ cluster: devnet() });
const signer = new PrivateKeySigner(secretKey);
const account = createPubkeyAccount({ signer, nonce: 0n });
const wallet = createWalletClient({ client, account });

await wallet.requestAirdrop();
const balance = await wallet.getBalance();
```

For local funding with an explicit raw amount, use the standalone `fundAccount`
action. Persist the request, network hash and public faucet address before
sending; retry the same nonce after an uncertain response. The response carries
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
enough first credit can fund it; a small credit can be excluded with a scheduler
`retry` outcome. The transfer example funds both accounts first
because its 1,000-unit credit cannot cover a new balance item's deposit.

The live funding test verifies an excluded 1,000-unit first credit, a successful
100,000-unit first credit with a deposit deduction, and a later 1,000-unit credit
without another balance-item deposit. It uses 500,000 child gas and 1,000,000 root
gas. Verified in Linux integration with CLI 0.25.0 and hog-devnode 0.1.30-rc.5;
storage costs depend on runtime configuration.

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
of interleaving. That lock does not make an earlier off-chain read current.
`clearAllowance({ spender })` revokes an allowance and deletes
its storage entry, and `clearBalance()` deletes the caller's empty balance
entry. Allowance changes emit `AllowanceChangeEvent` with the signed
`difference`; the earlier `ApprovalEvent` is gone with interface 0.1.41.

A receipt proves commitment; inspect its execution result. A `committed` status
may omit `height` until the indexer records it. `invalid` reports rejection,
while `recentFailure` is an advisory failed attempt. Receipt polling throws
`TransactionProcessingError` for `retry` or `dropped`, preserving the hash,
status, and scheduler error. `retry` permits resubmitting the same signed
transaction; `dropped` requires modifying it. The observer never resubmits.
A timeout or cancellation stops observation without proving the outcome.
Preserve signed evidence and resume observing the original hash instead of
automatically re-signing.

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
- [`transfer-hog.ts`](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/transfer-hog.ts) funds two pubkey accounts and transfers HOG on Devnet.
- [`view-hog-balance.ts`](https://github.com/thruputchain/thruput-sdk-ts/blob/main/examples/view-hog-balance.ts) reads an explicitly supplied public account’s HOG balance.
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
- `src/signers/` — `Signer` interface, `PrivateKeySigner` (ed25519 via `@noble/ed25519`), and `MlDsa65Signer` (ML-DSA-65 via `@noble/post-quantum`).
- `src/signedOp/` — off-chain signing of `SignedOp` operations: preimage construction and payload binding, plus the generated `SignedOp` binding re-exported from `src/contracts/signed_op.ts`.
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/openrpc.json` — pinned Thruput OpenRPC spec; `scripts/regen-openrpc.sh` refreshes it. After a regen, `npm test` (specifically `src/actions/contract.test.ts`) names any TS action whose serialized request no longer matches the new spec.
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
- `npm run contracts:generate` — regenerate all checked-in contract bindings from pinned specs.
- `npm run contracts:check` — verify generated bindings match their pinned specs and generator.
- `npm run docs` — generate TypeDoc API reference HTML in `docs/api/`.
- `npm run docs:check` — validate TypeDoc generation without writing output.
- `npm run format` / `format:check` — `prettier`.

### Live integration tests

This base58 branch requires matching wire-13 source builds on Linux with Node 24.
The release pins in [`scripts/integration-versions.json`](scripts/integration-versions.json)
still describe the wire-12.1 baseline and must be replaced after compatible releases exist.

```sh
THRUPUT_CLI=/absolute/path/to/thruput \
THRUPUT_DEVNODE_BINARY=/absolute/path/to/hog-devnode \
THRUPUT_EXPECTED_WIRE_FORMAT=13.0.0 \
npm run test:integration
```

The harness checks that the executable runs and starts a fresh node on an OS-assigned
loopback port. The host must provide the devnode's native runtime libraries;
CI uses the same Ubuntu 26.04 Namespace profile as the RPC repository. Tests
import the built package and check connection, local funding, a HOG transfer, receipts,
events, contract views, and RPC errors. `npm test` remains node-independent.

The transfer workflow also checks grouped reads and view freshness, an
authenticated wallet simulation, and recovery of admitted local-funding bytes
after a lost response. The pinned CLI 0.31.0 and hog-devnode 0.1.31-rc.8 use
wire 12.1.0, which carries ML-DSA-65 pubkey accounts but still uses hex identifiers.
Those release pins do not qualify this branch's base58 boundary.

An explicit CLI overrides the release pin; tests verify that the RPC server
reports that executable's version. The expected wire version defaults to
`scripts/integration-versions.json`; set `THRUPUT_EXPECTED_WIRE_FORMAT` when
testing a source build with a different wire version.
An explicit devnode skips runtime installation. Set `HOGD_PROTOCOL_OVERRIDE`
only when qualifying a compatible runtime with a different handshake token.

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

The tests do not perform capability discovery or fall back on unsupported runtimes.

Block-query qualification requires the same matching source builds.
It starts an isolated interval-driven node, submits known
transactions, compares both page orders with their receipts, checks empty blocks,
parent linkage and the canonical tip hash, and rejects zero limits:

```sh
npm run test:integration:blocks
```

Use the same optional `HOGD_PROTOCOL_OVERRIDE` rule as above. This profile requires
wire 13.0.0 and fails on unsupported nodes. Both profiles run in CI; their release
pins remain a qualification blocker for this branch. See
`scripts/regen-openrpc.sh` for the exact published schema-generator version.
Its default install requires private Cargo registry
access. `THRUPUT_OPENRPC_GENERATOR` can select a compatible local generator.

For local funding recovery, retain the original request before sending it.
A `LocalFundingUnresolved` RPC error preserves the original base58 `txHash` and
hex `signedTransaction` in `JsonRpcError.data`. These are transaction
evidence, not confirmation. Inspect that hash and retry the same request; do not
replace its nonce or amount while the outcome is uncertain.

## Publishing the renamed packages

The `@thruputchain/*` packages publish to GitHub Packages from repositories in
`thruputchain`. Release workflows use the repository's `GITHUB_TOKEN` with
`packages: write`.

Publish the protocol packages first, then the client, then React. Grant the
client and React repositories Actions read access to the protocol packages,
and grant React read access to the client package. Refresh downstream lockfiles
from the published artifacts before merging their PRs.

Existing `@groundhogchain/*` releases retain their original identities.
