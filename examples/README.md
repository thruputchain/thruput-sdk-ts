## Local Node Examples

These examples expect a local Groundhog JSON-RPC node. Start one first:

```bash
groundhog node
```

Run them with `tsx` from the repository root:

```bash
npx tsx examples/version.ts
npx tsx examples/chain-tip.ts
npx tsx examples/view-hog-balance.ts
npx tsx examples/transfer-hog.ts
```

Set `GROUNDHOG_RPC_URL` to override the default localhost endpoint:

```bash
GROUNDHOG_RPC_URL=http://127.0.0.1:9545 npx tsx examples/version.ts
```
