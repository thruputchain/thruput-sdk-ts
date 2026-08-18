# Counter Fixture

`counter.wasm` is an instrumented Counter contract used by the deployment example. It is stored in this repository for a self-contained example but is not published in the npm package.

## Provenance

- Source: [`groundhogchain/groundhog-examples`](https://github.com/groundhogchain/groundhog-examples), `contracts/counter`
- Source commit: `4ddb561e6e4bc02526005a8056d37b605ef0fd0d`
- Build CLI: [`groundhogchain/groundhog-rpc`](https://github.com/groundhogchain/groundhog-rpc)
- CLI commit: `b7ecd902f145a40e5831140ecbe9cf2ff1f2c1db` (`0.9.1`)
- Contract SDK: `0.19.0`
- Rust toolchain: `nightly-2026-07-01` (`rustc 1.98.0-nightly`)
- License: Apache-2.0
- Size: 8,163 bytes
- Raw file SHA-256: `d192a3d56c07d59045067525017fa3fa98540226a28fc5e627b7b0ab31801554`
- Canonical Groundhog contract hash: `b0eebb0a4095def30cdddfa007e05ebffec56d22c66861cfa1eb5dd5960290b1`

The two hashes serve different purposes. The raw checksum identifies this file. Deployment uses SHA-256 of the canonical encoded protocol `Contract`, which includes the WASM contract discriminant and blob framing.

## Rebuild

Use clean checkouts at the commits above, then run from the Counter contract directory:

```sh
cargo run --manifest-path <groundhog-rpc-checkout>/crates/tools/cli/Cargo.toml -- \
  build --target wasm -p counter --bindings ts --json
```

Copy these generated files:

```sh
cp <groundhog-examples-checkout>/target/groundhog/counter.wasm \
  examples/fixtures/counter.wasm
cp <groundhog-examples-checkout>/target/groundhog/counter.ts \
  examples/generated/counter.ts
```

Use `target/groundhog/counter.wasm`, which has passed Groundhog instrumentation and verification. Do not copy the uninstrumented Cargo output under `target/wasm32-unknown-unknown`.

The checked-in TypeScript binding differs from generated output only in its `@groundhogchain/client` imports. They point at `../../src/index.js` so repository examples run without a pre-existing `dist` build.
