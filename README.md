# @groundhogchain/client

TypeScript client for the [Groundhog](https://github.com/groundhogchain) blockchain.

## Install

```sh
npm install @groundhogchain/client
```

## Usage

```ts
import { createGroundhogClient, HttpTransport } from "@groundhogchain/client";

const client = createGroundhogClient(
  new HttpTransport("https://rpc.example.com"),
);

const tip = await client.getChainTip();
const receipt = await client.sendTransaction({
  /* ... */
});
```

## Examples

- [`chain-tip.ts`](examples/chain-tip.ts) reads the latest block height and hash.
- [`view-hog-balance.ts`](examples/view-hog-balance.ts) reads a HOG balance.
- [`transfer-hog.ts`](examples/transfer-hog.ts) submits a HOG transfer.
- [`deploy-counter.ts`](examples/deploy-counter.ts) deploys and calls a Counter contract.

See [`examples/README.md`](examples/README.md) for local-node setup and configuration.

## What's in this repo

- `src/client.ts` — `createGroundhogClient` factory that binds a transport to the SDK actions.
- `src/actions/` — RPC actions grouped by namespace:
  - `public/` — read methods (`getChainTip`, `getEvents`, `getStorageAt`, `getTransactionReceipt`, `getTransactionStatus`, `getTransactionsByAddress`).
  - `wallet/` — write methods (`sendTransaction`).
- `src/transaction/` — transaction build, serialize, and sign helpers.
- `src/contract/` — contract spec parsing, ABI-style `encode`, and TypeScript `codegen` from specs.
- `src/contracts/` — generated contract bindings. Standard bindings exported from `src/contracts/index.ts`.
- `src/transport/` — `HttpTransport` (JSON-RPC over HTTP) and `MockTransport` for tests.
- `src/signers/` — `Signer` interface and `PrivateKeySigner` (ed25519 via `@noble/ed25519`).
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/openrpc.json` — pinned Groundhog OpenRPC spec; `scripts/regen-openrpc.sh` refreshes it. After a regen, `npm test` (specifically `src/actions/contract.test.ts`) names any TS action whose serialized request no longer matches the new spec.
- `docs/` — supplementary docs.

## Subpath exports

The package exposes focused entry points alongside the root: `./transaction`, `./transport`, `./contract`, `./contracts`, `./signers`, `./actions`.

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
//npm.pkg.github.com/:_authToken=${GH_NPM_TOKEN}
```

And run installs with the token pulled from gh's keychain:

```sh
GH_NPM_TOKEN="$(gh auth token)" npm install
```

If you forget the prefix, npm fails with `Failed to replace env in config` —
that's your reminder.

## Scripts

- `npm run build` — bundle with `tsup` to `dist/`.
- `npm test` / `npm run test:watch` — run `vitest`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run docs` — generate TypeDoc API reference HTML in `docs/api/`.
- `npm run docs:check` — validate TypeDoc generation without writing output.
- `npm run format` / `format:check` — `prettier`.
