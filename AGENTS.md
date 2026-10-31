# AGENTS.md

## Setup

- Use npm, `package-lock.json` is the lockfile and CI runs `npm ci`.
- Develop with Node 24 (`.nvmrc`). The published runtime floor is Node 22.12.0; CI also tests the latest Node 22, 24, and 26 releases.
- All dependencies, including `@thruputchain/*`, install anonymously from the public npm registry. Do not reintroduce a GitHub Packages scope mapping in `.npmrc`.

## Verify

- Before a PR, run `npm run format:check`, `npm run docs:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:package-boundary`, and `npm run test:smoke`.
- `test:package-boundary` and `test:smoke` inspect `dist/`; run `npm run build` first.
- `npm run test:integration` builds and tests the package against a real local node on Linux / Node 24. CLI/devnode pins are in `scripts/integration-versions.json`; set `THRUPUT_CLI` to select the CLI executable. CI runs this separately from Vitest.
- The pinned CLI is the public `thruput` crate on crates.io (`cargo install thruput@<version> --locked`), and golden vectors come from the public `thruput-test-vectors` crate. Only the live-node `integration` job is limited to pull requests from this repository, because it runs on the project's self-hosted runner.
- Focused tests: `npm test -- src/actions/actions.test.ts` or `npm test -- src/actions/actions.test.ts -t "getEvents"`.
- `tsdown.config.ts` builds ESM, CJS, source maps, and declarations for every package entrypoint.
- There is no lint script; formatting is Prettier via `npm run format` / `npm run format:check`.
- `docs/` is generated TypeDoc output only. Put API documentation in source TSDoc and short onboarding guidance in `README.md`; do not add hand-written guides under `docs/`.

## Architecture

- Public package entrypoints are explicit: root plus `./transaction`, `./transport`, `./contract`, `./contracts`, `./signers`, `./actions`, `./signed-op`, `./provider`, and `./wallet`. Add public symbols to the matching `src/**/index.ts`; add `package.json` and `tsdown.config.ts` entries only for new subpaths.
- `src/provider/**` owns the framework-neutral wallet wire contract, strict boundary validation, and discovery. The normative contract lives in the developers-site repository at `src/content/docs/tools/wallet-provider.md`, published at https://docs.thruput.network/tools/wallet-provider/. Keep public TSDoc aligned with that contract. `src/wallet/providerClient.ts` adapts external pubkey wallets without a raw signer; signing never broadcasts and submission consumes an exact prior approval.
- `src/client.ts` provides the async `createThruputClient(options)` factory for both unqualified and cluster-validated clients. Keep native RPC binding in `src/rpc/**` and composed workflows in `src/actions/**`.
- Runtime transports implement `Transport.request(method, params)`. `HttpTransport` accepts named objects or positional arrays; native calls always send objects. `MockTransport` is test-only and intentionally implements only known methods.
- `src/contract/**` owns reusable contract codecs, typed method and event descriptors, fixed-length values, and strict decoding. `src/contracts/**` owns generated standard bindings.
- `src/signedOp/**` owns off-chain signing of `SignedOp` operations. The interface's binding is generated into `src/contracts/signed_op.ts` from `specs/contracts/signed_op.spec.xdr` like every other standard binding, and `./signed-op` re-exports it next to the signing helpers.
- Generated methods expose invocation, view, and root-receipt decoding APIs. Generated events own decoding, named topic filters, and receipt extraction. Do not add wrappers that preserve older generated APIs.
- This is an ESM TypeScript package using `moduleResolution: "bundler"`; source imports use `.js` specifiers for local TS modules.

## Generated And Spec Files

- `src/contracts/erc20.ts`, `src/contracts/recursive_type.ts`, `src/contracts/default_wallet.ts`, `src/contracts/dev_wallet.ts`, `src/contracts/signed_op.ts`, `src/contracts/erc20_permit.ts`, and the example-local bindings under `examples/generated/` are generated; do not hand-edit. Only standard bindings are exported from `src/contracts/index.ts`.
- TypeScript binding codegen lives in `thruput-tools`. Regenerate every checked-in binding with `scripts/regenerate-contract-bindings.sh`, setting `THRUPUT_CLI` to a reviewed generator build; use `--check` to verify checked-in output. The script always uses the pinned inputs in `specs/contracts/`.
- The regeneration script rewrites only the generated self-import to a repository-relative import. Generated output must compile for strict consumers, including `noUncheckedIndexedAccess`.
- `specs/native-openrpc.json` is the Rust-owned native contract snapshot. Refresh it with `scripts/regen-openrpc.sh` using a reviewed native generator or its generated source file; preserve provenance, wire-version and page-limit checks.
- After changing the fixture or request serialization, run `npm run rpc:check` and `npm test`; `src/rpc/client.test.ts` covers every native method against the generated schema and validates emitted named params.

## Examples

- Examples run through `npm run example <name>` and expect a local `thruput node` unless `THRUPUT_RPC_URL` is set.
- Examples are curated onboarding paths, not one file per RPC method. Keep them focused on helping new users get running with the SDK quickly.
- Repository examples intentionally import `../src/...` to exercise the checkout. Consumer-facing documentation must use `@thruputchain/client` package imports.

## Release

- Publishing is manual via `.github/workflows/publish.yml`; a version bump does not authorize publishing. The workflow defaults to dry-run and repeats formatting, docs, generated-contract, RPC, type, test, build, smoke, package-boundary and both live-node suites before publishing to npm. See `RELEASING.md` for authentication and release order.

## Native RPC boundary

`createRpcClient` is the low-level wire-14 client. Its generated types and compact codecs derive from the Rust-owned `specs/native-openrpc.json`; run `npm run rpc:generate` after refreshing that fixture and `npm run rpc:check` to verify it. `scripts/regen-native-openrpc.sh` requires a reviewed native generator or its generated source snapshot until the native generator release is pinned. Set `THRUPUT_NATIVE_OPENRPC_COMMIT` to the full reviewed tools commit; regeneration records its semantic JSON digest in `specs/native-openrpc.provenance.json`. Do not hand-edit generated files. The composed client uses the same native boundary. Before publishing, qualify the built SDK against the exact native CLI/runtime artifact set and update the integration pins; unit tests do not establish runtime compatibility.

Integration CI normally installs `cli` from `scripts/integration-versions.json`. During a coordinated release, optional `cliSourceCommit` selects a full reviewed tools commit: the shared action obtains a repository-scoped read-only App token, builds with that source's toolchain and lockfile, and runs the same suites against the pinned published devnode. Remove the source pin after the corresponding CLI release is qualified. Before tests, the harness checks `getVersionInfo` against the executable version, wire version, and source pin. Logs record that observed identity and the runtime pins; a source build is not installed-release artifact qualification.

An explicit `THRUPUT_CLI` path still must match the configured version and source SHA. For a local unpinned candidate only, set `THRUPUT_ALLOW_LOCAL_CANDIDATE=1` with that path; this mode is recorded separately in the qualification metadata and rejected in CI. Runtime, protocol, and wire overrides also require local candidate mode and are recorded; CI rejects them.
