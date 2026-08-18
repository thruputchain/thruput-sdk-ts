## Local Node Examples

These examples expect a local Groundhog JSON-RPC node. Start one first:

```bash
groundhog node
```

Run them from the repository root:

```bash
npm run example chain-tip
npm run example view-hog-balance
npm run example transfer-hog
npm run example deploy-counter
```

`chain-tip.ts` defaults to the localhost endpoint. Set `GROUNDHOG_RPC_URL` to
override it:

```bash
GROUNDHOG_RPC_URL=http://127.0.0.1:9545 npm run example chain-tip
```

`groundhog node` records its active RPC URL and runtime manifest in the global
Groundhog config. The HOG and deployment examples use
[`helpers/local-dev.ts`](helpers/local-dev.ts) to read that state and derive the
well-known local signers. Accounts marked as `faucet` are excluded. The examples
use the lowest-index `local_user`; the transfer example uses the next one as its
recipient. No key setup or environment variables are required.

Scripts can override the recorded RPC URL with `GROUNDHOG_RPC_URL` and the
manifest path with `GROUNDHOG_RUNTIME_MANIFEST`.

The state-changing examples intentionally target `groundhog node`. Hosted
networks require a user-owned wallet and signer rather than local bootstrap keys.

`deploy-counter.ts` deploys the included Counter fixture, increments it, and
reads the value back from the derived address. It uses the checked-in DevWallet
binding for the local node's wallet calls. See
[`docs/contract-deployment.md`](../docs/contract-deployment.md) for the deployment
model and address derivation rules.

The included fixture and Counter binding come from
[`groundhog-examples/contracts/counter`](https://github.com/groundhogchain/groundhog-examples/tree/56208548187a653af650b6c6b1708bac1b93b5e7/contracts/counter).
The fixture's raw SHA-256 is
`3ce9c1f3257a080679ac95aa9597c00cc39f66f1c89fa1cac27c6a4c9ddb3903`;
its canonical Groundhog contract hash is
`4eb0b279d37ff9ff0d73a94ec26102cc5d0b9ea7f726ba63bdf123a876d2c2ef`.
The DevWallet binding comes from
[`integration_test_contracts/dev_wallet`](https://github.com/groundhogchain/integration_test_contracts/tree/c2036930aee317f5cb0ad0c887237b7ed1db6c42/dev_wallet).
Both bindings were generated with `groundhog 0.9.1`. A network using another
wallet interface needs its corresponding generated binding.

To build and generate a binding for your own RV32 contract:

```bash
groundhog build --target rv32
groundhog codegen ts target/groundhog/counter.spec.xdr --output counter.ts
```

The build writes `target/groundhog/counter.rv32a` and the corresponding
`counter.spec.xdr`; replace `counter` with your contract crate name.

The local DevWallet funds each derived contract address with 100,000,000 base
units (10 HOG) before deployment because that address pays the deployment
storage charge. The sender wallet must have enough HOG for this wallet-specific
policy; it is not part of the protocol-level contract deployment mechanism.

The derived accounts are intended for local dev nodes only. They are not testnet
or mainnet account material.
