# Block clock artifact

`block-clock.rv32a` is a test fixture for the live block time test in
`tests/integration/live-node.test.mjs`. Its one view, `BlockClock.now()`,
returns the timepoint of the block it runs in, in Unix nanoseconds.

It is the output of `thruput build -p block-clock` with CLI 0.48.0, in
`crates/testkit/tests/fixtures/contracts` of thruput-tools at commit `78e09ba6`
(the 0.48.0 release).

- Artifact SHA-256: `37d9a36bf65a1ef658afb47a634570a12bd5051d596cb7a2e6321bcddfaa7870`.
- Artifact size: 2,108 bytes, with an embedded contract spec.
- Contract SDK: `thruput-sdk` 0.64.0.
- Compiler: `rustc 1.98.0-nightly (f46ec5218 2026-06-30)`.

The test reads the interface from the embedded spec, so no spec or binding is
kept for it in `specs/contracts`.
