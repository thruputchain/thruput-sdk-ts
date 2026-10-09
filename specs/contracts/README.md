# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. They use the optional method-effect
schema in `@groundhogchain/contract-spec` 0.13.0. CI and publishing use
`groundhog-cli` 0.26.0-pre.1, which includes the method-effect generator from
[groundhog-rpc #505](https://github.com/groundhogchain/groundhog-rpc/pull/505).
Set `GROUNDHOG_CLI` to that executable when checking or regenerating bindings
locally.

The generator nests each interface under its major and each named type, enum,
and event under its spec id's crate and major
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
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `b0cdc8758218414aeef32b7d867ad015e1890685572088fe970cf6c030efea0b` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `64aa9042721f2c058c67deec49fb832ed8a7066ba7bc01033ffc295991b28aa1` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `fd87c2afa964eb2bb773ec174e12c478f65129f29d737b2e3456efb1e7958490` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `a48e5253d576cf73d85686746edbd7c361acc06a7b06d01f5946dc94703228d2` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `3e9d774763433068bddf1d24ae52505390f2660f0ba154314b41055d53362849` |
| `signed_op.spec.xdr`      | `src/contracts/signed_op.ts`      | `7b1308d1a879a7c55e9181c915a0616d4c73d3ab473cd786be522b05ba069b6a` |
| `erc20_permit.spec.xdr`   | `src/contracts/erc20_permit.ts`   | `7fee20cfe1710de2ea4898737f3047c0e9fef04b146cfd3857585b0aaa291add` |

For GH-446 these fixtures were re-encoded with the canonical effect-enabled
codec, leaving every undeclared effect absent. Removing that field and
re-encoding with the previous codec reproduced each original input byte for
byte. No effect was inferred from a method name or receiver. The provenance
below describes the original inputs, before that metadata-only regeneration.

Each original spec was extracted with `groundhog build` on the `nightly-2026-07-01`
toolchain (the wallets on hogd's `nightly-2026-05-01`), from CLI 0.19.0:

- `signed_op.spec.xdr` is the SignedOp interface of `groundhog-signed-op-if`
  0.1.41, built from that crate's rv32 spec carrier at
  `groundhogchain/sdk_rs@d362b08eac6c1eebc27e5134b3f575711d76b2be` (SDK 0.41.1,
  interfaces 0.1.41). The interface is unchanged since 0.1.36; only the
  version stamp moved.
- `erc20.spec.xdr` combines the `groundhog-erc20-if` and
  `groundhog-erc20-metadata-if` 0.1.41 interfaces: the ERC20 spec carrier at the
  same sdk_rs revision, with `sdk::export_interface_spec!` anchoring both traits
  (the committed carrier anchors only ERC20; the metadata anchor and a
  `groundhog-erc20-metadata-if` path dependency were added for the build). This
  is the delta-allowance API from sdk_rs #482: `adjust_allowance` takes an
  `exclusive` flag, `clear_allowance` and `clear_balance` are new, and
  `AllowanceChangeEvent` replaces `ApprovalEvent`. hog-devnode 0.1.29-rc.4 is
  the first devnode whose native token implements it.
- `erc20_permit.spec.xdr` is the ERC20Permit interface of
  `groundhog-erc20-permit-if` 0.1.41 at the same sdk_rs revision. That crate
  ships no spec carrier, so one was added for the build: an `entrypoints`
  feature, a `groundhog_erc20_permit_if` rv32 bin, and a `main.rs` anchoring
  `groundhog_erc20_permit_if::ERC20Permit`, mirroring the ERC20 carrier.
- `recursive_type.spec.xdr` is `example-contracts/recursive_type` at the same
  sdk_rs revision, built through an rv32 bin that links the library. Its bytes
  are unchanged from the previous pin.
- `default_wallet.spec.xdr` and `dev_wallet.spec.xdr` are the wallets at
  `groundhogchain/integration_test_contracts@4d6a0b07ef280de89e55f1633e630c3d266e65a4`,
  the revision `hogd` v0.1.29-rc.4 builds into hog-devnode 0.1.29-rc.4. They
  were built with that hogd tag's `built_contracts` cargo configuration and
  `Cargo.lock` (SDK 0.41.0, `groundhog-erc20-if` 0.1.41). Both specs are
  byte-identical to the previous pin: DefaultWallet's `deploy` still takes a HOG
  `amount` and an optional `WalletInitCall` initializer since
  [integration_test_contracts #56](https://github.com/groundhogchain/integration_test_contracts/pull/56),
  and neither wallet's ABI changed between rc.3 and rc.4.
- `counter.spec.xdr` is `contracts/counter` at
  `groundhogchain/groundhog-examples@ff1481f006d35b7779f046c11e106b41df1b6bec`,
  built against SDK 0.38.0; see [fixture provenance](../../examples/fixtures/README.md).
