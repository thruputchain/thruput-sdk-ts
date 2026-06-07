# Repository Instructions

## Commands

- Use `npm ci` for setup; use `npm install` only when intentionally changing dependencies. `@groundhogchain/*` packages resolve through GitHub Packages via `.npmrc`, so unauthenticated installs may need a GitHub package token.
- CI uses Node 22 and runs `npm run format:check`, `npm run typecheck`, `npm run test`, then `npm run build`.
- Release workflow runs `npm run build`, `npm run test`, then `npm run typecheck`; do not assume CI and release run checks in the same order.
- Run a focused test with `npx vitest run src/path/to/file.test.ts`; `npm test` always runs the full Vitest suite.
- Regenerate the pinned OpenRPC snapshot with `scripts/regen-openrpc.sh`; it installs the pinned generator, writes `specs/openrpc.json`, and formats it.

## Package Boundaries

- Public package entrypoints are only the root plus `./transaction`, `./transport`, `./contract`, `./signers`, and `./actions`, as defined in `package.json` and `tsup.config.ts`.
- `src/contracts/*` contains generated bindings used by tests; they are not a supported package subpath unless `package.json` and `tsup.config.ts` are changed together.
- Keep ESM source imports with explicit `.js` specifiers; `tsconfig.json` uses `moduleResolution: "bundler"` and strict isolated modules.

## Source Layout

- `src/actions/*` contains transport-first RPC actions; `src/client.ts` should stay a thin binding layer over those actions.
- `src/transport/*` defines JSON-RPC transport behavior; keep request/response parsing in actions unless it is transport-generic.
- `src/transaction/*` builds, serializes, and signs protocol transactions; avoid mixing RPC concerns into transaction helpers.
- `src/contract/*` handles contract specs, calldata encoding, and generated binding support; `src/contracts/*` is generated test fixture code.
- `src/types/rpc.ts` contains public RPC-facing TypeScript shapes shared by actions and client methods.

## Protocol Boundaries

- Transaction helpers should use the codecs and utilities from `@groundhogchain/protocol` rather than reimplementing wire serialization or hashing.
- Contract helpers should use CXS codecs from `@groundhogchain/contract-spec`; keep protocol TXS/XDR concerns separate from contract calldata and return-data encoding.
- `MockTransport` is deterministic and non-executing; use it for focused unit tests, but verify RPC wire shapes against contract tests or a real RPC source.

## RPC Parity Sources

- Treat `specs/openrpc.json` as the checked-in RPC contract for this package.
- When wire shapes are unclear, verify against the current upstream RPC implementation or OpenRPC source before preserving older request shapes.
- After regenerating `specs/openrpc.json`, run `npm test`; `src/actions/contract.test.ts` validates public action request shapes against the snapshot.
