# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI pins `groundhog-cli` 0.17.7 and
checks every generated output against them.

| Input                     | Generated binding                 | SHA-256                                                            |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `e47c3c3f5a2ced8142bc2c947aa3a5cd60e985bba7661c9407266f8ec0f51501` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `dae0d7375953dd3ac2a7f6e1004411208071dd554678024806b883a745cde39a` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `87ac6490d7fd455b17ba38796399f21e0abc90c4b7c1f2f1b99cf00197b5aacc` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `4e3d10d51600ad3b7f686766dd9a87795b32010b0b7665d69f33ef7d8ddd6fec` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `a70415a648f89596b1b793f549cca1adcfd38bd38f9a74d99fd135c1aaa93061` |
| `signed_op.spec.xdr`      | `src/contracts/signed_op.ts`      | `9926dfd941fc2f107d9c33c82182b97d6402a0dd56e13755b5fa67ef908fabee` |

The Counter ABI comes from
`groundhogchain/groundhog-examples@56208548187a653af650b6c6b1708bac1b93b5e7`.
The DevWallet ABI comes from
`groundhogchain/integration_test_contracts@c2036930aee317f5cb0ad0c887237b7ed1db6c42`,
and the DefaultWallet ABI comes from
`groundhogchain/integration_test_contracts@1ae55638fc6c3fdd655a44c9fba0f4d69934ab7a`.
These contract revisions predate the raw-spec format accepted by CLI 0.9.6,
so their canonical specs were serialized from the reviewed macro-defined ABI.
Regeneration preserves their entrypoint IDs, exception selectors, and event
signatures.

`signed_op.spec.xdr` is the finalized spec of `groundhog-signed-op-if` 0.1.22,
built from that crate's rv32 spec carrier in `groundhogchain/sdk_rs`.

`erc20.spec.xdr` combines the released `groundhog-erc20-if` and
`groundhog-erc20-metadata-if` 0.1.24 interfaces. It was extracted with CLI
0.15.1 from an RV32 spec carrier using SDK 0.31.0 and
`sdk::export_interface_spec!` for both traits. TypeScript generation uses the
CLI 0.17.7 pin above.
