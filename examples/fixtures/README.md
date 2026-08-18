# Counter Fixture

`counter.rv32a` is a lowered RV32 Counter contract used by the deployment example. It is stored in this repository for a self-contained example but is not published in the npm package.

## Provenance

- Source: [`groundhogchain/groundhog-examples`](https://github.com/groundhogchain/groundhog-examples), `contracts/counter`
- Source commit: `4ddb561e6e4bc02526005a8056d37b605ef0fd0d`
- Build CLI: [`groundhogchain/groundhog-rpc`](https://github.com/groundhogchain/groundhog-rpc)
- CLI commit: `b7ecd902f145a40e5831140ecbe9cf2ff1f2c1db` (`0.9.1`)
- Contract SDK: `0.19.0`
- Rust toolchain: `nightly-2026-07-01` (`rustc 1.98.0-nightly`)
- License: Apache-2.0
- Size: 10,185 bytes
- Raw file SHA-256: `3ce9c1f3257a080679ac95aa9597c00cc39f66f1c89fa1cac27c6a4c9ddb3903`
- Canonical Groundhog contract hash: `4eb0b279d37ff9ff0d73a94ec26102cc5d0b9ea7f726ba63bdf123a876d2c2ef`

The two hashes serve different purposes. The raw checksum identifies this file. Deployment uses SHA-256 of the canonical encoded protocol `Contract`, which includes the RV32 contract discriminant and blob framing.

## Rebuild

Use clean checkouts at the commits above:

```sh
export GROUNDHOG_RPC_CHECKOUT=/path/to/groundhog-rpc
export GROUNDHOG_EXAMPLES_CHECKOUT=/path/to/groundhog-examples
export GROUNDHOG_CLIENT_CHECKOUT=/path/to/client-ts

cd "$GROUNDHOG_EXAMPLES_CHECKOUT/contracts/counter"

cargo run --manifest-path "$GROUNDHOG_RPC_CHECKOUT/crates/tools/cli/Cargo.toml" -- \
  build --target rv32 -p counter --json

cargo run --manifest-path "$GROUNDHOG_RPC_CHECKOUT/crates/tools/cli/Cargo.toml" -- \
  codegen ts "$GROUNDHOG_EXAMPLES_CHECKOUT/target/groundhog/counter.spec.xdr" \
  --output "$GROUNDHOG_EXAMPLES_CHECKOUT/target/groundhog/counter.ts" --json
```

Copy these generated files:

```sh
cp "$GROUNDHOG_EXAMPLES_CHECKOUT/target/groundhog/counter.rv32a" \
  "$GROUNDHOG_CLIENT_CHECKOUT/examples/fixtures/counter.rv32a"
cp "$GROUNDHOG_EXAMPLES_CHECKOUT/target/groundhog/counter.ts" \
  "$GROUNDHOG_CLIENT_CHECKOUT/examples/generated/counter.ts"
```

Use `target/groundhog/counter.rv32a`, the lowered Groundhog artifact container. Do not copy the raw ELF under `target/riscv32im-unknown-none-elf`.

The checked-in TypeScript binding points its `@groundhogchain/client` imports at `../../src/index.js` so repository examples run without a pre-existing `dist` build, and it is formatted with this repository's Prettier configuration. Its entrypoints, contract spec, calldata encoding, and decoding logic match generated output.
