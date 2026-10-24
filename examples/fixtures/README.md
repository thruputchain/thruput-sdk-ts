# Counter artifact

`counter.rv32a` is rebuilt with SDK 0.57.0 for hog-devnode 0.1.31-rc.16.

- Contract source: `contracts/counter/` in
  `thruput-examples@c82a5d18e7e806ad449b2672124372f74a142c8f`.
- SDK: `thruput-sdk` 0.57.0 from the `thruput` registry.
- Toolchain: `nightly-2026-07-01`, CLI 0.39.0.
- Artifact SHA-256: `f91cea94a5b80183e9b0a931a8944e30d28e1123c32df914906728b1880399c9`.

Built with `thruput build -p counter` in a workspace holding only the
`counter` package (its test-only dev-dependencies removed), the examples
repository's `.cargo/config.toml`, `.cargo/contract.toml`, `rust-toolchain.toml`,
and `trim-paths` release profile, and `thruput-sdk = "=0.57.0"`.

The build writes `counter.spec.xdr`, which is the pinned input in
`specs/contracts/`. The spec is byte-identical to the previous SDK 0.38.0 build;
only the artifact's code changed.

Regenerating TypeScript alone does not change an older artifact's embedded spec.
Rebuild the artifact and regenerate bindings together when adopting an SDK
change.
