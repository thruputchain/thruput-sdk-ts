# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI pins `groundhog-cli` 0.9.6 and
checks every generated output against them.

| Input                     | Generated binding                  | SHA-256                                                            |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`           | `8637042643d709ff823975d8e9c58aa70e16a6f4c87d37744615f988dec5c7d0` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts`  | `dae0d7375953dd3ac2a7f6e1004411208071dd554678024806b883a745cde39a` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`    | `a70415a648f89596b1b793f549cca1adcfd38bd38f9a74d99fd135c1aaa93061` |
| `dev_wallet.spec.xdr`     | `examples/generated/dev_wallet.ts` | `4e3d10d51600ad3b7f686766dd9a87795b32010b0b7665d69f33ef7d8ddd6fec` |

The Counter ABI comes from
`groundhogchain/groundhog-examples@56208548187a653af650b6c6b1708bac1b93b5e7`,
and the DevWallet ABI comes from
`groundhogchain/integration_test_contracts@c2036930aee317f5cb0ad0c887237b7ed1db6c42`.
Those contracts predate the raw-spec format accepted by the current CLI, so
their canonical specs were serialized from the reviewed generated `spec`
objects checked into PR #34. Regeneration with CLI 0.9.6 preserves their
entrypoint IDs, Counter exception selector, and Counter event signature.
