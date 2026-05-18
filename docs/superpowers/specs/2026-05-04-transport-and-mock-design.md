# Transport, MockTransport, Actions, and Client Design

## Overview

Add the transport layer, a stateful mock for testing, typed RPC actions, and an optional client factory. This completes the client library's architecture: transaction building → signing → serialization → transport → typed responses.

## Architecture

```
Developer code
    ↓
Client (optional convenience wrapper)
    ↓
Actions (typed functions, hex conversion)
    ↓
Transport interface (generic JSON-RPC pipe)
    ↓
HttpTransport (real node)  OR  MockTransport (in-memory, testing)
```

## Transport Interface

Generic JSON-RPC request/response. No knowledge of Groundhog types.

```ts
interface Transport {
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}
```

Two implementations:

- `HttpTransport` — sends HTTP POST with JSON-RPC 2.0 envelope, uses `fetch`
- `MockTransport` — in-memory state, routes method calls to handlers

## HttpTransport

Takes a URL, handles the JSON-RPC 2.0 framing:

- Wraps each call in `{ jsonrpc: "2.0", id, method, params }`
- Parses response, returns `result` or throws on `error`
- Auto-incrementing request ID
- No external dependencies (uses built-in `fetch`)

```ts
const transport = new HttpTransport("http://localhost:8545");
```

## MockTransport

Stateful in-memory mock implementing the Transport interface. Starts empty, populates state as methods are called. Does not execute transactions — stores them and returns success receipts.

Internal state:

- `transactions: Map<string, { raw: string, receipt: TransactionReceipt }>` — stored by tx hash
- `blockHeight: number` — increments when transactions are "committed"
- `devAccounts: DevAccount[]` — pre-populated dev accounts

Methods implemented incrementally. Starting set:

- `groundhog_sendRawTransaction` — deserialize the hex tx, compute hash, store, return hash
- `groundhog_getTransactionReceipt` — look up by hash, return receipt or null
- `groundhog_getTransactionStatus` — look up by hash, return status
- `groundhog_chainTip` — return current height + a deterministic hash
- `groundhog_dev_reset` — clear all state
- `groundhog_dev_getAccounts` — return pre-funded dev accounts

Unimplemented methods throw: `Method "X" not implemented in MockTransport`.

## Actions

Standalone typed functions: `(transport, typedParams) → Promise<typedResult>`. Each action:

1. Converts typed inputs to hex/JSON (e.g., `SignedTransaction` → serialized hex string)
2. Calls `transport.request(methodName, params)`
3. Parses JSON response into typed objects (e.g., hex hash string → `SHA256Hash`)

### Public actions (read-only, `src/actions/public/`)

- `getChainTip(transport)` → `Promise<ChainTip>`
- `getTransactionReceipt(transport, txHash)` → `Promise<TransactionReceipt | null>`
- `getTransactionStatus(transport, txHash)` → `Promise<TransactionStatus>`
- `getBlockByNumber(transport, height)` → `Promise<Block>`
- `getPendingTransactionCount(transport)` → `Promise<number>`
- `getEvents(transport, query)` → `Promise<EventPage>`

### Wallet actions (write, `src/actions/wallet/`)

- `sendTransaction(transport, signedTx)` → `Promise<SHA256Hash>`

### Dev actions (`src/actions/dev/`)

- `devReset(transport)` → `Promise<void>`
- `devGetAccounts(transport)` → `Promise<DevAccount[]>`
- `devGetTransactionDetail(transport, txHash)` → `Promise<TransactionDetail>`
- `devGetStorageAt(transport, address, key)` → `Promise<StorageItem>`

## Response Types

Most types come from `@groundhogchain/gateway` and `@groundhogchain/protocol` — no need to redefine them in client-ts. The gateway package exports XDR types for the RPC layer: `BlockHeader`, `EventPage`, `EventQuery`, `IdentifiedEvent`, `TxEmittedEvent`, `TxInfo`, etc.

The actions layer receives JSON with `0x`-hex strings from the transport, parses hex into the branded protocol types (`ContractAddress`, `SHA256Hash`, `BlockHeight`, etc.), and returns gateway/protocol types directly.

The only client-ts-specific types are thin wrappers for RPC responses that don't have a direct XDR equivalent (e.g., `ChainTip` combining height + hash, `TransactionStatus` discriminated union for pending/committed/unknown). These live in `src/types/rpc.ts`.

## Client Factory

Optional convenience that binds a transport to all actions:

```ts
const client = createGroundhogClient(transport);
client.getChainTip();
client.sendTransaction(signedTx);
client.dev.reset();
client.dev.getAccounts();
```

Dev methods namespaced under `client.dev` to keep them visually separate. The client is a thin object — each method just calls the corresponding action with the bound transport.

## Hex Conversion

All hex conversion happens in the actions layer, not the transport:

- `toHex` / `fromHex` from `@groundhogchain/protocol/utils` for binary data
- Addresses: `ContractAddress` ↔ `"0x" + hex`
- Hashes: `SHA256Hash` ↔ `"0x" + hex`
- Transactions: `SignedTransaction` → serialize to XDR → `"0x" + hex`
- Block heights: `bigint` ↔ JSON integer

## OpenRPC Spec

Checked in at `specs/openrpc.json`. The spec is the source of truth for method names, parameter shapes, and response schemas; the hand-written action serializers (`src/actions/**`) must match it on the wire.

Refresh workflow when the gateway's RPC types change:

1. Run `scripts/regen-openrpc.sh`. This `cargo install`s the latest `groundhog-open-rpc-spec` binary and rewrites `specs/openrpc.json` from the live Rust schemas.
2. Run `npm test`. The contract test (`src/actions/contract.test.ts`) validates each action's serialized `params` against its declared schema in the new spec — failures point at exactly which method's serializer fell behind.
3. Update the offending serializer(s) until the contract test passes.
4. Commit the new `specs/openrpc.json` and the matching TS changes together.

The contract test is what closes the loop: without it, a stale serializer ships green CI and breaks consumers (see #14).

## Testing Strategy

- **MockTransport unit tests**: verify each mock method returns correct shapes, state transitions work (send tx → get receipt), dev_reset clears state
- **Action tests**: use MockTransport, verify typed inputs produce correct RPC calls and typed outputs parse correctly
- **Contract tests** (`src/actions/contract.test.ts`): pin each action's serialized JSON-RPC `params` against the schemas in `specs/openrpc.json` (ajv). Catches spec→serializer drift.
- **HttpTransport**: tested against a real local node (integration test, not part of CI initially)
- **End-to-end**: build tx with generated bindings → sign → send via mock → get receipt — proves the full pipeline

## What's NOT in scope

- WebSocket transport (future, when subscriptions are needed)
- Gas estimation (no RPC method for it yet)
- Transaction simulation / dry-run
- Retry logic, rate limiting, connection pooling
