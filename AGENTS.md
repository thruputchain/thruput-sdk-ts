# AGENTS.md

## Setup

- Use npm, `package-lock.json` is the lockfile and CI runs `npm ci`.
- Develop with Node 24 (`.nvmrc`). The published runtime floor is Node 22.12.0; CI also tests the latest Node 22, 24, and 26 releases.
- `@groundhogchain/*` dependencies come from GitHub Packages. A clean install needs package-read authentication because `.npmrc` maps that scope to `https://npm.pkg.github.com`.

## Verify

- Before a PR, run `npm run format:check`, `npm run docs:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:package-boundary`, and `npm run test:smoke`.
- `test:package-boundary` and `test:smoke` inspect `dist/`; run `npm run build` first.
- Focused tests: `npm test -- src/actions/actions.test.ts` or `npm test -- src/actions/actions.test.ts -t "getEvents"`.
- `tsdown.config.ts` builds ESM, CJS, source maps, and declarations for every package entrypoint.
- There is no lint script; formatting is Prettier via `npm run format` / `npm run format:check`.

## Architecture

- Public package entrypoints are explicit: root plus `./transaction`, `./transport`, `./contract`, `./contracts`, `./signers`, `./actions`, and the Node-only `./local-dev`. Add public symbols to the matching `src/**/index.ts`; add `package.json` and `tsdown.config.ts` entries only for new subpaths.
- `src/client.ts` provides the async `createGroundhogClient(options)` factory for both unqualified and cluster-validated clients. Keep action behavior in `src/actions/**`; client methods should just bind the transport.
- Runtime transports implement `Transport.request(method, params)`. `HttpTransport` sends JSON-RPC arrays with `params ?? []`; `MockTransport` is test-only and intentionally implements only known methods.
- `src/contract/**` owns reusable contract codecs, typed method and event descriptors, fixed-length values, and strict decoding. `src/contracts/**` owns generated standard bindings.
- Generated methods expose invocation, view, and root-receipt decoding APIs. Generated events own decoding, named topic filters, and receipt extraction. Do not add wrappers that preserve older generated APIs.
- This is an ESM TypeScript package using `moduleResolution: "bundler"`; source imports use `.js` specifiers for local TS modules.

## Generated And Spec Files

- `src/contracts/erc20.ts`, `src/contracts/recursive_type.ts`, `src/contracts/default_wallet.ts`, `src/contracts/dev_wallet.ts`, and the example-local bindings under `examples/generated/` are generated; do not hand-edit. Only standard bindings are exported from `src/contracts/index.ts`.
- TypeScript binding codegen lives in `groundhog-rpc`. Regenerate every checked-in binding with `scripts/regenerate-contract-bindings.sh`, setting `GROUNDHOG_CLI` to a reviewed generator build; use `--check` to verify checked-in output. The script always uses the pinned inputs in `specs/contracts/`.
- The regeneration script rewrites only the generated self-import to a repository-relative import. Generated output must compile for strict consumers, including `noUncheckedIndexedAccess`.
- `specs/openrpc.json` is the pinned Groundhog OpenRPC spec. Regenerate with `scripts/regen-openrpc.sh`, which installs a pinned `groundhog-open-rpc-spec@x.y.z` from the Cargo `groundhog` registry and formats the JSON; bump the hardcoded script version when syncing to a newer RPC spec release.
- After changing `specs/openrpc.json` or action request serialization, run `npm test`; `src/actions/contract.test.ts` should cover every supported OpenRPC method and validates emitted JSON-RPC params against the OpenRPC schemas.

## Examples

- Examples run through `npm run example <name>` and expect a local `groundhog node` unless `GROUNDHOG_RPC_URL` is set.
- Examples are curated onboarding paths, not one file per RPC method. Keep them focused on helping new users get running with the SDK quickly.
- Repository examples intentionally import `../src/...` to exercise the checkout. Consumer-facing documentation must use `@groundhogchain/client` package imports.

## Release

- Publishing is manual via `.github/workflows/publish.yml`; a version bump does not authorize publishing. The workflow repeats formatting, docs, type, test, build, smoke, and package-boundary checks before tagging and publishing to GitHub Packages.
