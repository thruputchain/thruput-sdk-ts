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

Pass a cluster when the application must validate the endpoint before making
requests:

```ts
import { createGroundhogClient, devnet, toHex0x } from "@groundhogchain/client";

const client = await createGroundhogClient({
  cluster: devnet(),
});

console.log(toHex0x(client.network.networkHash));
```

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

Generated contract bindings are exported separately:

```ts
import { ERC20 } from "@groundhogchain/client/contracts";

const balance = await ERC20.getBalanceOf.view({
  client,
  contract: tokenAddress,
  args: { addr: accountAddress },
});

const transfer = ERC20.transfer.invocation(tokenAddress, gasLimit, {
  receiver: recipientAddress,
  amount: 1_000n,
});
```

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
    return CustomWallet.execute.invocation(accountAddress, request.gasLimit, {
      call: request.invocation,
      policy: request.policy,
    });
  },
});
```

Because wallet decoration binds account-specific closures to the supplied
client, each client instance can be bound once. Create another client instance
when operating multiple accounts against the same endpoint.

## Signed operations

A signed operation authorizes an on-chain action off-chain: the signer signs a
`#[contract_type]` payload together with the network, the verifying contract,
a per-signer nonce, and an expiry height, and anyone can submit it. The
contract verifies it with the `groundhog-signed-op` Rust component. The
`@groundhogchain/client/signed-op` entrypoint is the client half.

```ts
import {
  SignedOp,
  defineSignedOperation,
} from "@groundhogchain/client/signed-op";
import { spec, MyWallet, type Transfer } from "./generated/my_wallet.js";

// Bind the payload type from the contract's generated spec. Its definition is
// part of the signed bytes, so a payload with the same encoding but a
// different type never shares a signature.
const transfer = defineSignedOperation<Transfer>({
  typeDefs: spec.type_defs,
  typeName: "Transfer",
});

const nonce = await SignedOp.nextSignedOpNonce.view({
  client,
  contract: walletAddress,
  args: { signer: signer.publicKey.ed25519 },
});

const { op, signature } = await transfer.sign(signer, {
  network: networkHash,
  verifyingContract: walletAddress,
  nonce: nonce.value,
  validUntil: currentHeight + 100n,
  body: { to: recipient, amount: 42n },
});

// `op` and `signature` are the arguments of whichever entrypoint hands the
// operation to the verifying contract; the submitter need not be the signer.
const invocation = MyWallet.submit.invocation(walletAddress, gasLimit, {
  op,
  signature,
});
```

`signedOperationPreimage` exposes the exact bytes a signature covers, for
signers this package does not drive.

## Examples

- [`chain-tip.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/chain-tip.ts) validates Devnet and reads its latest block.
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
- `src/signedOp/` — off-chain signing of `SignedOp` operations: preimage construction, payload binding, and the interface's nonce view.
- `src/local-dev/` — Node.js-only local runtime discovery and deterministic bootstrap signer loading.
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/openrpc.json` — pinned Groundhog OpenRPC spec; `scripts/regen-openrpc.sh` refreshes it. After a regen, `npm test` (specifically `src/actions/contract.test.ts`) names any TS action whose serialized request no longer matches the new spec.
- `docs/` — implementation specifications and generated API documentation.

## Subpath exports

The package exposes focused entry points alongside the root: `./transaction`,
`./transport`, `./contract`, `./contracts`, `./signers`, `./actions`,
`./signed-op`, and the Node.js-only `./local-dev` helper.

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
- `npm run contracts:generate` — regenerate all checked-in contract bindings from pinned specs.
- `npm run contracts:check` — verify generated bindings match their pinned specs and generator.
- `npm run docs` — generate TypeDoc API reference HTML in `docs/api/`.
- `npm run docs:check` — validate TypeDoc generation without writing output.
- `npm run format` / `format:check` — `prettier`.
