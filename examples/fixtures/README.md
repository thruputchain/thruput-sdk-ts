# Counter artifact

`counter.rv32a` is a local RV32 v6 candidate with XDR extensions. It is not
release-qualified.

- Artifact SHA-256: `a30a03b40c243f94478169ba9a2f8e4367e1ec0d5a043971a5f6238c6f12f6e2`.
- Artifact size: 6,433 bytes, including a 548-byte embedded spec.
- Format fingerprint: `0x0e336ac8e46602e1`.
- Compiler: `rustc 1.98.0-nightly (f46ec5218 2026-06-30)`.
- Container writer: tools #706, commit `1d26e7020a9a5b4f4b22aeb4bc10ea0d399cb06b`.

The embedded spec is byte-identical to `specs/contracts/counter.spec.xdr`.
The container was regenerated from the earlier fixed-header v6 fixture
(`2fd701db90657fd4caae5e2e70739e90cd73ea59b408228e4bba92f19db14f82`)
with `build_artifact_with_spec`. Code, initial memory, execution header fields,
and spec bytes are unchanged. Only the container encoding changed.
The matching runtime retains v5 execution support. Published integration pins
and explorer's counter fixture must be aligned during the coordinated release.

Exact committed build provenance and independent reproduction remain release
requirements. This fixture alone does not establish either.

Regenerating TypeScript alone does not change an older artifact's embedded spec.
Rebuild the artifact and regenerate bindings together when adopting an SDK
change.
