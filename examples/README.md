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
GROUNDHOG_WALLET_ENTRYPOINT=0x... \
npm run example -- examples/transfer-hog.ts
```

`deploy-counter.ts` deploys the included Counter fixture, increments it, and
reads the value back from the derived address. Its wallet selectors can be
overridden when a network does not use the local defaults. See
[`docs/contract-deployment.md`](../docs/contract-deployment.md) for the deployment
model and address derivation rules.

```bash
GROUNDHOG_SENDER_ADDRESS=0x... \
GROUNDHOG_SENDER_PRIVATE_KEY=0x... \
GROUNDHOG_WALLET_DEPLOY_ENTRYPOINT=0x... \
GROUNDHOG_WALLET_ENTRYPOINT=0x... \
GROUNDHOG_DEPLOYMENT_NONCE=0x... \
npm run example -- examples/deploy-counter.ts
```

`GROUNDHOG_DEPLOYMENT_NONCE` is optional and must contain exactly 32 bytes. A
random value is generated when it is omitted. See
[`fixtures/README.md`](fixtures/README.md) for the artifact's source, license,
checksums, and reproduction steps. The fixture is stored in this repository but
is not part of the published npm package.

The checked-in defaults were verified with `groundhog 0.9.1`. Other runtime
manifests may advertise different wallet addresses and entrypoints; pass the
overrides above when they do.

The defaults are intended for local dev nodes only. They are not testnet or
mainnet account material.
