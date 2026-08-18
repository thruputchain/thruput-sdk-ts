## Local Node Examples

These examples expect a local Groundhog JSON-RPC node. Start one first:

```bash
groundhog node
```

Run them from the repository root:

```bash
npm run example -- examples/chain-tip.ts
npm run example -- examples/view-hog-balance.ts
npm run example -- examples/transfer-hog.ts
npm run example -- examples/deploy-counter.ts
```

`chain-tip.ts` defaults to the localhost endpoint. Set `GROUNDHOG_RPC_URL` to
override it:

```bash
GROUNDHOG_RPC_URL=http://127.0.0.1:9545 npm run example -- examples/chain-tip.ts
```

`groundhog node` records its active RPC URL and runtime manifest in the global
Groundhog config. The HOG and deployment examples use
[`helpers/local-dev.ts`](helpers/local-dev.ts) to read that state and derive the
well-known local signers. `dev-0` is reserved for the faucet and is never
selected. The examples use `dev-1` as their first `local_user`; the transfer
example uses `dev-2` as its recipient. No key setup or environment variables are
required.

Scripts can override the recorded RPC URL with `GROUNDHOG_RPC_URL` and the
manifest path with `GROUNDHOG_RUNTIME_MANIFEST`.

`deploy-counter.ts` deploys the included Counter fixture, increments it, and
reads the value back from the derived address. It uses the checked-in DevWallet
binding for the local node's wallet calls. See
[`docs/contract-deployment.md`](../docs/contract-deployment.md) for the deployment
model and address derivation rules.

Each run generates a random 32-byte deployment nonce. See
[`fixtures/README.md`](fixtures/README.md) for the artifact's source, license,
checksums, and reproduction steps. The fixture is stored in this repository but
is not part of the published npm package.

The checked-in DevWallet binding was generated with `groundhog 0.9.1`. A network
using another wallet interface needs its corresponding generated binding.

The local DevWallet funds each derived contract address with 100,000,000 HOG
before deployment because that address pays the deployment storage charge. The
sender wallet must have enough HOG for this wallet-specific policy; it is not
part of the protocol-level contract deployment mechanism.

The derived accounts are intended for local dev nodes only. They are not testnet
or mainnet account material.
