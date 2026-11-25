# Counter artifact

`counter.rv32a` is an RV32 v7 artifact with an embedded contract spec. It is
the output of `thruput build -p counter` with CLI 0.47.0 (commit `61ddf183`) in
thruput-examples at commit `afeacac`.

- Artifact SHA-256: `b35387f3de1943072bd0130966b957886f497601ed8297cebec4a55d03c747c1`.
- Artifact size: 6,425 bytes, including a 548-byte embedded spec.
- Header: 120 bytes, syscall API version 1.1.
- Format fingerprint: `0x95cbfa8b3b2f37da`.
- Contract SDK: `thruput-sdk` 0.62.0.
- Compiler: `rustc 1.98.0-nightly (f46ec5218 2026-06-30)`.

The embedded spec is byte-identical to `specs/contracts/counter.spec.xdr`.

Regenerating TypeScript alone does not change an older artifact's embedded spec.
Rebuild the artifact and regenerate bindings together when adopting an SDK
change.
