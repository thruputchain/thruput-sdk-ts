# @groundhogchain/client

TypeScript client for the [Groundhog](https://github.com/groundhogchain) blockchain.

## Install

```sh
npm install @groundhogchain/client
```

## Usage

```ts
import {
  createGroundhogClient,
  HttpTransport,
  PrivateKeySigner,
} from "@groundhogchain/client";

const client = createGroundhogClient({
  transport: new HttpTransport("https://rpc.example.com"),
  signer: new PrivateKeySigner(privateKeyBytes),
});

const tip = await client.getChainTip();
const receipt = await client.sendTransaction({
  /* ... */
});
```

## What's in this repo

- `src/client.ts` — `createGroundhogClient` factory tying transport, signer, and actions together.
- `src/actions/` — RPC actions grouped by namespace:
  - `public/` — read methods (`getChainTip`, `getEvents`, `getStorageAt`, `getTransactionReceipt`, `getTransactionStatus`).
  - `wallet/` — write methods (`sendTransaction`).
  - `dev/` — developer-only endpoints.
- `src/transaction/` — transaction build, serialize, hash, and sign helpers.
- `src/contract/` — contract spec parsing, ABI-style `encode`, and TypeScript `codegen` from specs.
- `src/contracts/` — example contract bindings (`erc20`, `recursive_type`) used for tests, generated via the Groundhog CLI's `groundhog codegen` command.
- `src/transport/` — `HttpTransport` (JSON-RPC over HTTP) and `MockTransport` for tests.
- `src/signers/` — `Signer` interface and `PrivateKeySigner` (ed25519 via `@noble/ed25519`).
- `src/types/rpc.ts` — typed RPC request/response shapes.
- `specs/openrpc.json` — pinned Groundhog OpenRPC spec; `scripts/regen-openrpc.sh` refreshes it. `src/actions/contract.test.ts` pins SDK serialization to this snapshot, so a regen surfaces drift on the next `npm test`.
- `docs/` — supplementary docs.

## Subpath exports

The package exposes focused entry points alongside the root: `./transaction`, `./transport`, `./contract`, `./signers`, `./actions`.

## Scripts

- `npm run build` — bundle with `tsup` to `dist/`.
- `npm test` / `npm run test:watch` — run `vitest`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run format` / `format:check` — `prettier`.
