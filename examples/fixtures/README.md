# Counter artifact

`counter.rv32a` is rebuilt with SDK 0.38.0, whose contract specs name types by
structured spec id ([sdk_rs #447](https://github.com/groundhogchain/sdk_rs/pull/447)).

- Contract source: `contracts/counter/` in
  `groundhog-examples@ff1481f006d35b7779f046c11e106b41df1b6bec`.
- SDK: `sdk` 0.38.0 from the `groundhog` registry.
- Toolchain: `nightly-2026-07-01`, CLI 0.19.0-pre.1.
- Artifact SHA-256: `c517c726a871169b2e78dbd6bbd4becb39d8528dbaced9439b7454c479a1c3d0`.

Built with `groundhog build -p counter` in a workspace holding only the
`counter` package (its test-only dev-dependencies removed), the examples
repository's `.cargo/config.toml`, `.cargo/contract.toml`, `rust-toolchain.toml`,
and `trim-paths` release profile, and `sdk = "=0.38.0"`.

The build writes `counter.spec.xdr`, which is the pinned input in
`specs/contracts/`. The ABI and the `PingEvent` signature are unchanged; only the
spec's type names moved to spec ids.

Regenerating TypeScript alone does not change an older artifact's embedded spec.
Rebuild the artifact and regenerate bindings together when adopting an SDK
change.
