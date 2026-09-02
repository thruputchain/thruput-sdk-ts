# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI pins `groundhog-cli` 0.9.6 and
checks every generated output against them.

| Input                     | Generated binding                 | SHA-256                                                            |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `8637042643d709ff823975d8e9c58aa70e16a6f4c87d37744615f988dec5c7d0` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `dae0d7375953dd3ac2a7f6e1004411208071dd554678024806b883a745cde39a` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `87ac6490d7fd455b17ba38796399f21e0abc90c4b7c1f2f1b99cf00197b5aacc` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `4e3d10d51600ad3b7f686766dd9a87795b32010b0b7665d69f33ef7d8ddd6fec` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `a70415a648f89596b1b793f549cca1adcfd38bd38f9a74d99fd135c1aaa93061` |

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

`signed_op.spec.xdr` (SHA-256
`539be7a614633dedd5c151c63931347a42a7719a5abb6d04c0dc6a17de942947`) is the
finalized spec of `groundhog-signed-op-if` 0.1.19, built from that crate's
rv32 spec carrier in `groundhogchain/sdk_rs`. It has no generated binding:
`execute_signed_op` returns auth tokens, which the generator does not emit yet.
`src/signedOp/interface.ts` mirrors it by hand and
`src/signedOp/interface.test.ts` checks the mirror against this file.
