# AGENTS.md

## Setup

- Use npm, `package-lock.json` is the lockfile and CI runs `npm ci`.
- CI uses Node 22 and GitHub Packages for `@groundhogchain/*`; a clean local `npm ci` may need GitHub Packages auth because `.npmrc` points that scope at `https://npm.pkg.github.com`.

## Verify

- CI order is `npm run format:check`, `npm run typecheck`, `npm test`, then `npm run build`.
- Focused tests: `npm test -- src/actions/actions.test.ts` or `npm test -- src/actions/actions.test.ts -t "getEvents"`.
- Use `npm run build` to validate package exports and declaration output; `tsup.config.ts` builds ESM, CJS, sourcemaps, and d.ts into `dist/`.
- There is no lint script; formatting is Prettier via `npm run format` / `npm run format:check`.

## Architecture

- Public package entrypoints are explicit: root plus `./transaction`, `./transport`, `./contract`, `./signers`, and `./actions`. Add new exported surface to the matching `src/**/index.ts`, `src/index.ts` if root-exported, and `package.json`/`tsup.config.ts` only for new subpaths.
- `src/client.ts` is a thin `createGroundhogClient(transport)` wrapper around standalone actions. Keep action behavior in `src/actions/**`; client methods should just bind the transport.
- Runtime transports implement `Transport.request(method, params)`. `HttpTransport` sends JSON-RPC arrays with `params ?? []`; `MockTransport` is test-only and intentionally implements only known methods.
- This is an ESM TypeScript package using `moduleResolution: "bundler"`; source imports use `.js` specifiers for local TS modules.

## Generated And Spec Files

- `src/contracts/erc20.ts` and `src/contracts/recursive_type.ts` are generated bindings; do not hand-edit unless the task is explicitly about checked-in generated output.
- `specs/openrpc.json` is the pinned Groundhog OpenRPC spec. Regenerate with `scripts/regen-openrpc.sh`, which installs a pinned `groundhog-open-rpc-spec@x.y.z` from the Cargo `groundhog` registry and formats the JSON; bump the hardcoded script version when syncing to a newer RPC spec release.
- After changing `specs/openrpc.json` or action request serialization, run `npm test`; `src/actions/contract.test.ts` should cover every supported OpenRPC method and validates emitted JSON-RPC params against the OpenRPC schemas.

## Examples

- Examples run through `npm run example -- examples/<file>.ts` and expect a local `groundhog node` unless `GROUNDHOG_RPC_URL` is set.
- Examples are curated onboarding paths, not one file per RPC method. Keep them focused on helping new users get running with the SDK quickly.

## Release

- Publishing is manual via `.github/workflows/publish.yml`; it builds, tests, typechecks, tags `v${package.json.version}`, then runs `npm publish` to GitHub Packages.
