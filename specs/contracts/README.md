# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI and publishing use
`groundhog-cli` 0.19.0 to check every generated output against them. From
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
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `d5762631cc07d8e1368d230a7d4e7a08a1c3b8c88bd310c564f388bb79c1a542` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `bb7810e7d6e14f3475cb3a2bc2a80a475ca9dab835ab5c87ac1206f83e6cad78` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `a27530845e19e21efc82f544e75775b74549738a968972316d22927c1a2028a6` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `4e3d10d51600ad3b7f686766dd9a87795b32010b0b7665d69f33ef7d8ddd6fec` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `efaa47be6de159dcd6044806d1ffe48816492a777867d8b6e20e9dd6559a928a` |
| `signed_op.spec.xdr`      | `src/contracts/signed_op.ts`      | `a740d207885e00b4c6329f13cee388d2028592a4c7171b04a9a75fae2e1a509d` |
| `erc20_permit.spec.xdr`   | `src/contracts/erc20_permit.ts`   | `aa0fe1df469cf87a739271d5b2c7aedd524625c0ac42212d4d26096fb35139f2` |

Each spec was extracted with `groundhog build` on the `nightly-2026-07-01`
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
