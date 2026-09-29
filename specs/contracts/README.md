# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI and publishing use
`groundhog-cli` 0.19.0-pre.2 to check every generated output against them. From
that release the generator nests each interface under its major and each named
type, enum, and event under its spec id's crate and major
([groundhog-rpc #451](https://github.com/groundhogchain/groundhog-rpc/pull/451)).

Every named type in these specs is identified by a structured spec id (crate,
major version, module path, declared name), the format introduced by SDK 0.38.0
([sdk_rs #447](https://github.com/groundhogchain/sdk_rs/pull/447),
[#472](https://github.com/groundhogchain/sdk_rs/pull/472)) and adopted by CLI
0.19.0-pre.1 ([groundhog-rpc #441](https://github.com/groundhogchain/groundhog-rpc/pull/441)).
Entrypoint IDs, exception selectors, and event signatures are derived as
before, so the regenerated bindings address the same on-chain ABI.

| Input                     | Generated binding                 | SHA-256                                                            |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `a4eb5ba202ca4a5f21e1421c0d9b62d3b0e21af1053652e739a60aa107f4fe94` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `bb7810e7d6e14f3475cb3a2bc2a80a475ca9dab835ab5c87ac1206f83e6cad78` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `a27530845e19e21efc82f544e75775b74549738a968972316d22927c1a2028a6` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `4e3d10d51600ad3b7f686766dd9a87795b32010b0b7665d69f33ef7d8ddd6fec` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `efaa47be6de159dcd6044806d1ffe48816492a777867d8b6e20e9dd6559a928a` |
| `signed_op.spec.xdr`      | `src/contracts/signed_op.ts`      | `6c1913336e786f072a362831e94b9321f53fb1fa86f0ee8e985700d62b43834a` |

Each spec was extracted with `groundhog build` on the `nightly-2026-07-01`
toolchain, from CLI 0.19.0-pre.2 for the wallets and 0.19.0-pre.1 for the rest:

- `signed_op.spec.xdr` is the SignedOp interface of `groundhog-signed-op-if`
  0.1.36, built from that crate's rv32 spec carrier at
  `groundhogchain/sdk_rs@17cc9db4989c16139ff438b45c0f1b27a2ed8166` (v0.38.0).
- `erc20.spec.xdr` combines the `groundhog-erc20-if` and
  `groundhog-erc20-metadata-if` 0.1.36 interfaces: the ERC20 spec carrier at the
  same sdk_rs revision, with `sdk::export_interface_spec!` anchoring both traits.
- `recursive_type.spec.xdr` is `example-contracts/recursive_type` at the same
  sdk_rs revision, built through an rv32 bin that links the library.
- `default_wallet.spec.xdr` and `dev_wallet.spec.xdr` are the wallets at
  `groundhogchain/integration_test_contracts@83577b0f79618c3219490983ff96849a2bd8c28f`,
  the revision `hogd` v0.1.29-rc.3 builds into hog-devnode 0.1.29-rc.3. They
  were built with that hogd tag's `built_contracts` cargo configuration and
  `Cargo.lock` (SDK 0.39.0, `groundhog-erc20-if` 0.1.37). DefaultWallet's
  `deploy` takes a HOG `amount` and an optional `WalletInitCall` initializer
  since [integration_test_contracts #56](https://github.com/groundhogchain/integration_test_contracts/pull/56);
  its entrypoint ID is unchanged. `dev_wallet` declares no named types, so its
  spec is byte-identical to the previous pin.
- `counter.spec.xdr` is `contracts/counter` at
  `groundhogchain/groundhog-examples@ff1481f006d35b7779f046c11e106b41df1b6bec`,
  built against SDK 0.38.0; see [fixture provenance](../../examples/fixtures/README.md).
