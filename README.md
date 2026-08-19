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

const client = createGroundhogClient(
  new HttpTransport("https://rpc.example.com"),
);

const tip = await client.getChainTip();
const txHash = await client.sendTransaction(signedTransaction);
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

## Examples

- [`chain-tip.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/chain-tip.ts) reads the latest block height and hash.
- [`view-hog-balance.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/view-hog-balance.ts) reads a HOG balance.
- [`transfer-hog.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/transfer-hog.ts) submits a HOG transfer.
- [`deploy-counter.ts`](https://github.com/groundhogchain/client-ts/blob/main/examples/deploy-counter.ts) deploys and calls a Counter contract.

See the [examples guide](https://github.com/groundhogchain/client-ts/blob/main/examples/README.md) for local-node setup and configuration.

Use the root entrypoint for the client and common runtime APIs. Focused
entrypoints are available for transactions, transports, contract runtime
helpers, generated standard contracts, signers, and standalone actions.

## What's in this repo

- `src/client.ts` — `createGroundhogClient` factory that binds a transport to the SDK actions.
- `src/actions/` — RPC actions grouped by namespace:
  - `public/` — chain, account, contract-view, event, and transaction queries.
  - `wallet/` — write methods (`sendTransaction`).
- `src/transaction/` — transaction build, serialize, and sign helpers.
- `src/contract/` — reusable codecs, typed method and event descriptors, fixed-length values, and contract spec helpers.
- `src/contracts/` — generated standard contract bindings exported through `@groundhogchain/client/contracts`.
- `src/transport/` — `HttpTransport` (JSON-RPC over HTTP) and `MockTransport` for tests.
- `src/signers/` — `Signer` interface and `PrivateKeySigner` (ed25519 via `@noble/ed25519`).
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/openrpc.json` — pinned Groundhog OpenRPC spec; `scripts/regen-openrpc.sh` refreshes it. After a regen, `npm test` (specifically `src/actions/contract.test.ts`) names any TS action whose serialized request no longer matches the new spec.
- `docs/` — implementation specifications and generated API documentation.

## Subpath exports

The package exposes focused entry points alongside the root: `./transaction`,
`./transport`, `./contract`, `./contracts`, `./signers`, and `./actions`.

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
