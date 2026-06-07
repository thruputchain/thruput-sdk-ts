## Local Node Examples

These examples expect a local Groundhog JSON-RPC node. Start one first:

```bash
groundhog node
```

Run them from the repository root:

```bash
npm run example -- examples/version.ts
npm run example -- examples/chain-tip.ts
npm run example -- examples/view-hog-balance.ts
npm run example -- examples/transfer-hog.ts
```

Set `GROUNDHOG_RPC_URL` to override the default localhost endpoint:

```bash
GROUNDHOG_RPC_URL=http://127.0.0.1:9545 npm run example -- examples/version.ts
```
