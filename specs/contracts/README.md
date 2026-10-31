# Contract Binding Inputs

These canonical `.spec.xdr` files are the complete inputs to
`scripts/regenerate-contract-bindings.sh`. CI and publishing use the `thruput`
CLI crate at the version pinned in `scripts/integration-versions.json`
(currently 0.42.0, installed with `cargo install thruput@0.42.0 --locked`). Set
`THRUPUT_CLI` to that executable when checking or regenerating bindings locally.

The generator nests each interface under its major and each named type, enum,
and event under its spec id's crate and major. Every named type in these specs
is identified by a structured spec id (crate, major version, module path,
declared name).

| Input                     | Generated binding                 | SHA-256                                                            |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `erc20.spec.xdr`          | `src/contracts/erc20.ts`          | `d52ae5f45f4b139e7e713d10d06cb3b81f45cdc91b6e302b62c47cd11ac73f80` |
| `recursive_type.spec.xdr` | `src/contracts/recursive_type.ts` | `64aa9042721f2c058c67deec49fb832ed8a7066ba7bc01033ffc295991b28aa1` |
| `default_wallet.spec.xdr` | `src/contracts/default_wallet.ts` | `06fcbb7714bc354faf70fa493377cdcc81ef5208abafe627f4a360ea748ad6c7` |
| `dev_wallet.spec.xdr`     | `src/contracts/dev_wallet.ts`     | `a48e5253d576cf73d85686746edbd7c361acc06a7b06d01f5946dc94703228d2` |
| `counter.spec.xdr`        | `examples/generated/counter.ts`   | `3e9d774763433068bddf1d24ae52505390f2660f0ba154314b41055d53362849` |
| `signed_op.spec.xdr`      | `src/contracts/signed_op.ts`      | `0156ff120374fd0d3c6cd231acc74eba827a02bb444236063e8f40d40aca9f05` |
| `erc20_permit.spec.xdr`   | `src/contracts/erc20_permit.ts`   | `11d767fa973f03a2bbd1219de93b01718642169d45c816108770f1813dccb1f3` |

Each spec was extracted with `thruput build` from CLI 0.39.0. The interfaces
and `recursive_type` use the `nightly-2026-07-01` toolchain; the wallets use
hogd's `nightly-2026-05-01`:

- `signed_op.spec.xdr` is the SignedOp interface of `thruput-signed-op-if`
  0.1.68, built from that crate's rv32 spec carrier at
  `thruputchain/thruput-sdk-rs@4fd125a082d404edf449267bb2ad8a4c333aa1d8`
  (SDK 0.57.0).
- `erc20.spec.xdr` combines the `thruput-erc20-if` and
  `thruput-erc20-metadata-if` 0.1.68 interfaces: the ERC20 spec carrier at the
  same revision, anchoring `ERC20` and `ERC20Metadata` (the committed carrier
  anchors `ERC20` and `ERC20AllowanceExpiry`; the metadata anchor and a
  `thruput-erc20-metadata-if` path dependency replace the expiry anchor for
  the build, keeping the binding's previous scope). Interface 0.1.68 renames
  `clear_allowance` and `clear_balance` to `delete_allowance` and
  `delete_balance`, adds `AllowanceDeleteEvent`, drops `burn` and `BurnEvent`,
  and carries amounts as `i128`. Its event signatures and ERC20 error selectors
  use `thruput` preimages; hog-devnode 0.1.31-rc.16 is the first devnode whose
  native token emits them.
- `erc20_permit.spec.xdr` is the ERC20Permit interface of
  `thruput-erc20-permit-if` 0.1.68 at the same revision. That crate ships no
  spec carrier, so one was added for the build: an `entrypoints` feature, a
  `thruput_erc20_permit_if` rv32 bin, and a `main.rs` anchoring
  `thruput_erc20_permit_if::ERC20Permit`, mirroring the ERC20 carrier.
  `clear_allowance_signed` is now `delete_allowance_signed`.
- `recursive_type.spec.xdr` is `example-contracts/recursive_type` at the same
  revision. Its bytes are unchanged from the previous pin.
- `default_wallet.spec.xdr` and `dev_wallet.spec.xdr` are the wallets at
  `thruputchain/thruput-integration-test-contracts@d626338fa651783cfa55916c73a12dcdcc8d0d49`,
  the revision `hogd` v0.1.31-rc.16 builds into hog-devnode 0.1.31-rc.16. They
  were built with that hogd tag's `built_contracts` cargo configuration and
  `Cargo.lock` (SDK 0.56.0, `thruput-erc20-if` 0.1.67). DefaultWallet's
  `deploy` still takes a native-token `amount` and an optional `WalletInitCall`
  initializer, but the amount is now `i128`. The DevWallet spec is unchanged.
- `counter.spec.xdr` is `contracts/counter` at
  `thruputchain/thruput-examples@c82a5d18e7e806ad449b2672124372f74a142c8f`,
  built against SDK 0.57.0; see [fixture provenance](../../examples/fixtures/README.md).
  Its bytes are unchanged from the previous pin.
