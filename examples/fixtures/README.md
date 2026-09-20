# Counter artifact

`counter.rv32a` is rebuilt for the direct scalar event-topic encoding introduced
by [sdk_rs #463](https://github.com/groundhogchain/sdk_rs/pull/463).

- Contract source: `contracts/counter/src/` in
  `groundhog-examples@62a87c3de4a62f60161b3fae525f54083d7892f0`.
- SDK: `sdk_rs@05d7a3c5c3ddc187a31e20e3f28feaafe5f22933` (unreleased 0.36.0).
- Toolchain: `nightly-2026-07-01`, CLI 0.17.7 with the codegen DX changes.
- Artifact SHA-256: `480c9316daf562c7d4a6b635340411e517b2ec2c0f320772397d18d1dc0ffde4`.

Built with an isolated `counter` 0.1.0 package pointing its library and binary at
the source paths above, an SDK path dependency on the reviewed checkout, and the
examples repository's RV32 rustflags/release profile and build-std overlay.
The command was `groundhog build --offline --show-cargo-commands`.

The resulting `counter.spec.xdr` is byte-identical to the pinned input in
`specs/contracts/`: the ABI and event signature did not change, but `ping` now
emits its `u64` tag directly. The live-node integration test verifies emitted
bytes against the client's scalar decoder and filter encoder.

Regenerating TypeScript alone does not change an older artifact's event encoding.
Rebuild the artifact and regenerate bindings together when adopting this SDK change.
