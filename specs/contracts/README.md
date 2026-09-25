# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI and publishing use
`groundhog-cli` 0.18.0 to check every generated output against them.

CLI 0.18.0 includes the generator updates from
[groundhog-rpc #409](https://github.com/groundhogchain/groundhog-rpc/pull/409).
Its direct scalar topic mappings match SDK 0.36.0
([sdk_rs #463](https://github.com/groundhogchain/sdk_rs/pull/463)). The bundled
Counter artifact has also been rebuilt for that encoding; see
[fixture provenance](../../examples/fixtures/README.md).

| Input                     | Generated binding                 | SHA-256                                                            |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `e47c3c3f5a2ced8142bc2c947aa3a5cd60e985bba7661c9407266f8ec0f51501` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `dae0d7375953dd3ac2a7f6e1004411208071dd554678024806b883a745cde39a` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `d9a687682eb3179df951789549b18e9f301841e5888a6504d7ff4ac0c3087675` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `4e3d10d51600ad3b7f686766dd9a87795b32010b0b7665d69f33ef7d8ddd6fec` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `a70415a648f89596b1b793f549cca1adcfd38bd38f9a74d99fd135c1aaa93061` |
| `signed_op.spec.xdr`      | `src/contracts/signed_op.ts`      | `9926dfd941fc2f107d9c33c82182b97d6402a0dd56e13755b5fa67ef908fabee` |

The Counter ABI comes from
`groundhogchain/groundhog-examples@56208548187a653af650b6c6b1708bac1b93b5e7`.
The DevWallet ABI comes from
`groundhogchain/integration_test_contracts@c2036930aee317f5cb0ad0c887237b7ed1db6c42`,
and the DefaultWallet ABI comes from
`groundhogchain/integration_test_contracts@abda17ab438f5e668209fb72c12aa695e9f60c3a`.
The DefaultWallet spec was built from the canonical Rust contract with SDK 0.36.1.
It contains the unified `deploy(nonce, contract_hash, amount, initializer)` ABI.
The entrypoint selector is unchanged; the argument shape intentionally replaces
the old unfunded deploy ABI. Its runtime must be upgraded before use.
The DevWallet revision predates the raw-spec format accepted by CLI 0.9.6,
so its canonical spec was serialized from the reviewed macro-defined ABI.

`signed_op.spec.xdr` is the finalized spec of `groundhog-signed-op-if` 0.1.22,
built from that crate's rv32 spec carrier in `groundhogchain/sdk_rs`.

`erc20.spec.xdr` combines the released `groundhog-erc20-if` and
`groundhog-erc20-metadata-if` 0.1.24 interfaces. It was extracted with CLI
0.15.1 from an RV32 spec carrier using SDK 0.31.0 and
`sdk::export_interface_spec!` for both traits. TypeScript generation uses the
CLI 0.18.0 pin above.
