# Counter artifact

`counter.rv32a` is a local RV32 v6 candidate built with the GH-558 Rust
CLI/lowerer. It is not release-qualified.

- Artifact SHA-256: `2fd701db90657fd4caae5e2e70739e90cd73ea59b408228e4bba92f19db14f82`.
- Artifact size: 6,421 bytes, including a 548-byte embedded spec.
- Format fingerprint: `0x36f9478fa875ca39`.
- Compiler: `rustc 1.98.0-nightly (f46ec5218 2026-06-30)`.
- Shared fixture: `thruput-explorer`'s `tests/fixtures/counter-v6.rv32a`.

The embedded spec is byte-identical to `specs/contracts/counter.spec.xdr`.
The previous v5 fixture is rejected by the candidate v6 runtime. Published
integration pins must be updated during the coordinated release.

Exact committed build provenance and independent reproduction remain release
requirements. This fixture alone does not establish either.

Regenerating TypeScript alone does not change an older artifact's embedded spec.
Rebuild the artifact and regenerate bindings together when adopting an SDK
change.
