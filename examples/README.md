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

Set `GROUNDHOG_RPC_URL` to override the default localhost endpoint:

```bash
GROUNDHOG_RPC_URL=http://127.0.0.1:9545 npm run example -- examples/chain-tip.ts
```

The HOG examples use local-dev wallet defaults and can be overridden with
environment variables:

```bash
GROUNDHOG_ACCOUNT_ADDRESS=0x... npm run example -- examples/view-hog-balance.ts

GROUNDHOG_SENDER_ADDRESS=0x... \
GROUNDHOG_RECIPIENT_ADDRESS=0x... \
GROUNDHOG_SENDER_PRIVATE_KEY=0x... \
npm run example -- examples/transfer-hog.ts
```

`deploy-counter.ts` deploys the included Counter fixture, increments it, and
reads the value back from the derived address. It uses the checked-in DevWallet
binding for the local node's wallet calls. See
[`docs/contract-deployment.md`](../docs/contract-deployment.md) for the deployment
model and address derivation rules.

```bash
GROUNDHOG_SENDER_ADDRESS=0x... \
GROUNDHOG_SENDER_PRIVATE_KEY=0x... \
npm run example -- examples/deploy-counter.ts
```

Each run generates a random 32-byte deployment nonce. See
[`fixtures/README.md`](fixtures/README.md) for the artifact's source, license,
checksums, and reproduction steps. The fixture is stored in this repository but
is not part of the published npm package.

The checked-in defaults and DevWallet binding were verified with `groundhog
0.9.1`. A network using another wallet interface needs its corresponding
generated binding.

The local DevWallet funds each derived contract address with 100,000,000 HOG
before deployment because that address pays the deployment storage charge. The
sender wallet must have enough HOG for this wallet-specific policy; it is not
part of the protocol-level contract deployment mechanism.

The defaults are intended for local dev nodes only. They are not testnet or
mainnet account material.
