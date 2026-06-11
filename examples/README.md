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

The defaults are intended for local dev nodes only. They are not testnet or
mainnet account material.
