# Transport, MockTransport, Actions & Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the transport layer (HTTP + mock), typed RPC actions, and a client factory so developers can send transactions and query a Groundhog node.

**Architecture:** Three layers — Transport (generic JSON-RPC pipe), Actions (typed functions with hex conversion), Client (convenience wrapper). MockTransport provides a stateful in-memory mock for testing without a real node. All RPC response types come from `@groundhogchain/gateway` and `@groundhogchain/protocol`.

**Tech Stack:** TypeScript, `@groundhogchain/protocol@0.3.2`, `@groundhogchain/gateway@0.3.2`, vitest, built-in `fetch`

---

## File Map

| File                                          | Responsibility                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `src/transport/types.ts`                      | Modify: update Transport interface signature                             |
| `src/transport/http.ts`                       | Create: HttpTransport (JSON-RPC 2.0 over HTTP)                           |
| `src/transport/mock.ts`                       | Create: MockTransport (stateful in-memory mock)                          |
| `src/transport/mock.test.ts`                  | Create: MockTransport tests                                              |
| `src/transport/index.ts`                      | Modify: re-export HttpTransport, MockTransport                           |
| `src/types/rpc.ts`                            | Create: client-specific RPC response types (ChainTip, TransactionStatus) |
| `src/actions/public/getChainTip.ts`           | Create: getChainTip action                                               |
| `src/actions/public/getTransactionReceipt.ts` | Create: getTransactionReceipt action                                     |
| `src/actions/public/getTransactionStatus.ts`  | Create: getTransactionStatus action                                      |
| `src/actions/public/index.ts`                 | Modify: re-export public actions                                         |
| `src/actions/wallet/sendTransaction.ts`       | Create: sendTransaction action                                           |
| `src/actions/wallet/index.ts`                 | Modify: re-export wallet actions                                         |
| `src/actions/dev/index.ts`                    | Create: dev actions (devReset, devGetAccounts)                           |
| `src/actions/index.ts`                        | Modify: re-export all action groups                                      |
| `src/actions/actions.test.ts`                 | Create: action tests using MockTransport                                 |
| `src/client.ts`                               | Modify: createGroundhogClient factory                                    |
| `src/client.test.ts`                          | Create: client factory tests                                             |
| `src/index.ts`                                | Modify: re-export client, types                                          |
| `tsup.config.ts`                              | Modify: add types entry point if needed                                  |
| `package.json`                                | Modify: add types sub-path export if needed                              |

---

### Task 1: Update Transport Interface

**Files:**

- Modify: `src/transport/types.ts`

- [ ] **Step 1: Update the Transport interface**

```ts
// src/transport/types.ts
export interface Transport {
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}
```

- [ ] **Step 2: Run typecheck to find breakage**

Run: `npm run typecheck`
Expected: may have errors in existing tests that use the old signature — fix any that appear.

- [ ] **Step 3: Commit**

```bash
git add src/transport/types.ts
git commit -m "Update Transport interface to typed JSON-RPC signature"
```

---

### Task 2: RPC Response Types

**Files:**

- Create: `src/types/rpc.ts`

These are the thin client-specific types that don't exist in gateway/protocol packages.

- [ ] **Step 1: Create the types file**

```ts
// src/types/rpc.ts
import type { SHA256Hash, BlockHeight } from "@groundhogchain/protocol";

export interface ChainTip {
  height: bigint;
  blockHash: SHA256Hash;
}

export type TransactionStatus =
  | { status: "pending" }
  | { status: "committed"; height: bigint }
  | { status: "invalid"; reason: string }
  | { status: "unknown" };

export interface TransactionReceipt {
  txHash: SHA256Hash;
  height: bigint;
  status: ExecStatus;
  events: EmittedEvent[];
  returnData: Uint8Array | null;
}

export type ExecStatus =
  | { result: "ok" }
  | { result: "reverted"; message?: string }
  | { result: "deterministicError"; kind: string }
  | { result: "validationFailure"; kind: string }
  | { result: "systemError" };

export interface EmittedEvent {
  contractAddress: SHA256Hash;
  topics: Uint8Array[];
  data: Uint8Array;
}

export interface DevAccount {
  address: SHA256Hash;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  storageTokens: bigint;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (new file, no imports of it yet)

- [ ] **Step 3: Commit**

```bash
git add src/types/rpc.ts
git commit -m "Add client-specific RPC response types"
```

---

### Task 3: HttpTransport

**Files:**

- Create: `src/transport/http.ts`

- [ ] **Step 1: Implement HttpTransport**

```ts
// src/transport/http.ts
import type { Transport } from "./types.js";

export class JsonRpcError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

export class HttpTransport implements Transport {
  #url: string;
  #nextId = 1;

  constructor(url: string) {
    this.#url = url;
  }

  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const id = this.#nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? [],
    });

    const response = await fetch(this.#url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();

    if (json.error) {
      throw new JsonRpcError(
        json.error.code,
        json.error.message,
        json.error.data,
      );
    }

    return json.result as T;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/transport/http.ts
git commit -m "Add HttpTransport with JSON-RPC 2.0 framing"
```

---

### Task 4: MockTransport

**Files:**

- Create: `src/transport/mock.ts`
- Create: `src/transport/mock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/transport/mock.test.ts
import { describe, expect, it } from "vitest";
import { MockTransport } from "./mock.js";

describe("MockTransport", () => {
  it("chainTip returns height 0 on empty state", async () => {
    const mock = new MockTransport();
    const result = await mock.request<{ height: number; blockHash: string }>(
      "groundhog_chainTip",
    );
    expect(result.height).toBe(0);
    expect(result.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("sendRawTransaction stores a tx and increments height", async () => {
    const mock = new MockTransport();
    const txHex = "0xdeadbeef";
    const hash = await mock.request<string>("groundhog_sendRawTransaction", [
      txHex,
    ]);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    const tip = await mock.request<{ height: number }>("groundhog_chainTip");
    expect(tip.height).toBe(1);
  });

  it("getTransactionReceipt returns receipt for submitted tx", async () => {
    const mock = new MockTransport();
    const hash = await mock.request<string>("groundhog_sendRawTransaction", [
      "0xdeadbeef",
    ]);
    const receipt = await mock.request("groundhog_getTransactionReceipt", [
      hash,
    ]);
    expect(receipt).not.toBeNull();
    expect((receipt as any).txHash).toBe(hash);
    expect((receipt as any).status.result).toBe("ok");
  });

  it("getTransactionReceipt returns null for unknown tx", async () => {
    const mock = new MockTransport();
    const receipt = await mock.request("groundhog_getTransactionReceipt", [
      "0x" + "00".repeat(32),
    ]);
    expect(receipt).toBeNull();
  });

  it("getTransactionStatus returns committed for submitted tx", async () => {
    const mock = new MockTransport();
    const hash = await mock.request<string>("groundhog_sendRawTransaction", [
      "0xdeadbeef",
    ]);
    const status = await mock.request("groundhog_getTransactionStatus", [hash]);
    expect((status as any).status).toBe("committed");
  });

  it("getTransactionStatus returns unknown for missing tx", async () => {
    const mock = new MockTransport();
    const status = await mock.request("groundhog_getTransactionStatus", [
      "0x" + "00".repeat(32),
    ]);
    expect((status as any).status).toBe("unknown");
  });

  it("dev_reset clears all state", async () => {
    const mock = new MockTransport();
    await mock.request("groundhog_sendRawTransaction", ["0xdeadbeef"]);
    await mock.request("groundhog_dev_reset");

    const tip = await mock.request<{ height: number }>("groundhog_chainTip");
    expect(tip.height).toBe(0);
  });

  it("dev_getAccounts returns pre-funded accounts", async () => {
    const mock = new MockTransport();
    const accounts = await mock.request<any[]>("groundhog_dev_getAccounts");
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0].address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(accounts[0].publicKey).toMatch(/^0x/);
    expect(accounts[0].privateKey).toMatch(/^0x/);
  });

  it("throws on unimplemented method", async () => {
    const mock = new MockTransport();
    await expect(
      mock.request("groundhog_getBlockByNumber", [0]),
    ).rejects.toThrow("not implemented");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/transport/mock.test.ts`
Expected: FAIL (MockTransport doesn't exist)

- [ ] **Step 3: Implement MockTransport**

```ts
// src/transport/mock.ts
import type { Transport } from "./types.js";

interface StoredTx {
  rawHex: string;
  hash: string;
  height: number;
}

export class MockTransport implements Transport {
  #transactions = new Map<string, StoredTx>();
  #blockHeight = 0;

  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    switch (method) {
      case "groundhog_chainTip":
        return this.#chainTip() as T;
      case "groundhog_sendRawTransaction":
        return this.#sendRawTransaction(params![0] as string) as T;
      case "groundhog_getTransactionReceipt":
        return this.#getTransactionReceipt(params![0] as string) as T;
      case "groundhog_getTransactionStatus":
        return this.#getTransactionStatus(params![0] as string) as T;
      case "groundhog_dev_reset":
        return this.#devReset() as T;
      case "groundhog_dev_getAccounts":
        return this.#devGetAccounts() as T;
      default:
        throw new Error(`Method "${method}" not implemented in MockTransport`);
    }
  }

  #chainTip() {
    const hashBytes = new Uint8Array(32);
    new DataView(hashBytes.buffer).setUint32(0, this.#blockHeight);
    const blockHash =
      "0x" +
      [...hashBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { height: this.#blockHeight, blockHash };
  }

  #sendRawTransaction(txHex: string) {
    this.#blockHeight++;
    const hashInput = new TextEncoder().encode(txHex + ":" + this.#blockHeight);
    const hashBytes = new Uint8Array(32);
    for (let i = 0; i < hashInput.length && i < 32; i++) {
      hashBytes[i] = hashInput[i];
    }
    const hash =
      "0x" +
      [...hashBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.#transactions.set(hash, {
      rawHex: txHex,
      hash,
      height: this.#blockHeight,
    });
    return hash;
  }

  #getTransactionReceipt(txHash: string) {
    const tx = this.#transactions.get(txHash);
    if (!tx) return null;
    return {
      txHash: tx.hash,
      height: tx.height,
      status: { result: "ok" },
      events: [],
      returnData: null,
    };
  }

  #getTransactionStatus(txHash: string) {
    const tx = this.#transactions.get(txHash);
    if (!tx) return { status: "unknown" };
    return { status: "committed", height: tx.height };
  }

  #devReset() {
    this.#transactions.clear();
    this.#blockHeight = 0;
    return null;
  }

  #devGetAccounts() {
    // Generate 3 deterministic dev accounts
    return Array.from({ length: 3 }, (_, i) => {
      const seed = new Uint8Array(32);
      seed[0] = i + 1;
      const toHexStr = (bytes: Uint8Array) =>
        "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      return {
        address: toHexStr(seed),
        publicKey: toHexStr(seed),
        privateKey: toHexStr(seed),
        storageTokens: 1000000,
      };
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/transport/mock.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/transport/mock.ts src/transport/mock.test.ts
git commit -m "Add MockTransport with stateful in-memory mock"
```

---

### Task 5: Update Transport Barrel Exports

**Files:**

- Modify: `src/transport/index.ts`

- [ ] **Step 1: Update exports**

```ts
// src/transport/index.ts
export type { Transport } from "./types.js";
export { HttpTransport, JsonRpcError } from "./http.js";
export { MockTransport } from "./mock.js";
```

- [ ] **Step 2: Run typecheck and all tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/transport/index.ts
git commit -m "Export HttpTransport and MockTransport from transport barrel"
```

---

### Task 6: Hex Conversion Helpers

**Files:**

- Create: `src/actions/hex.ts`

Shared helpers for the actions layer to convert between typed protocol objects and `0x`-prefixed hex strings.

- [ ] **Step 1: Create hex helpers**

```ts
// src/actions/hex.ts
import type { SHA256Hash, ContractAddress } from "@groundhogchain/protocol";
import {
  toHex,
  fromHex,
  sha256Hash,
  contractAddress,
} from "@groundhogchain/protocol";

export function toHex0x(bytes: Uint8Array): string {
  return "0x" + toHex(bytes);
}

export function fromHex0x(hex: string): Uint8Array {
  if (!hex.startsWith("0x")) {
    throw new Error(`Expected 0x-prefixed hex string, got: ${hex}`);
  }
  return fromHex(hex.slice(2));
}

export function hashFromHex(hex: string): SHA256Hash {
  return sha256Hash(fromHex0x(hex));
}

export function addressFromHex(hex: string): ContractAddress {
  return contractAddress(fromHex0x(hex));
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/actions/hex.ts
git commit -m "Add hex conversion helpers for actions layer"
```

---

### Task 7: sendTransaction Action

**Files:**

- Create: `src/actions/wallet/sendTransaction.ts`
- Modify: `src/actions/wallet/index.ts`

- [ ] **Step 1: Write the failing test**

Add to a new test file:

```ts
// src/actions/actions.test.ts
import { describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  calldata,
  contractEntrypointID,
  AuthClaimType,
  bitMap,
  weight,
} from "@groundhogchain/protocol";
import { MockTransport } from "../transport/mock.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createInvocation, createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import { sendTransaction } from "./wallet/sendTransaction.js";

function makeSignedTx() {
  const secretKey = new Uint8Array(32);
  secretKey[0] = 0x01;
  const signer = new PrivateKeySigner(secretKey);

  const tx = createTransaction({
    invocation: createInvocation({
      invoked_address: contractAddress(new Uint8Array(32)),
      entrypoint: contractEntrypointID(new Uint8Array(8)),
      gas_limit: gasAmount(1_000_000n),
      calldata: calldata(new Uint8Array(0)),
    }),
    uniquifier: {
      block_expiry_height: blockHeight(100n),
      nonce: 1n,
    },
    contracts_to_deploy: [],
    auth_claim: {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(0xffffffffn),
        required_weight: weight(1n),
      },
    },
  });

  return signTransaction(tx, [{ signer, publicKeyId: 0n }]);
}

describe("sendTransaction", () => {
  it("sends a signed transaction and returns a hash", async () => {
    const transport = new MockTransport();
    const signed = await makeSignedTx();
    const hash = await sendTransaction(transport, signed);
    expect(hash.length).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/actions/actions.test.ts`
Expected: FAIL (sendTransaction doesn't exist)

- [ ] **Step 3: Implement sendTransaction**

```ts
// src/actions/wallet/sendTransaction.ts
import type { SignedTransaction, SHA256Hash } from "@groundhogchain/protocol";
import { serialize, codec } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import { toHex0x, hashFromHex } from "../hex.js";

export async function sendTransaction(
  transport: Transport,
  signedTx: SignedTransaction,
): Promise<SHA256Hash> {
  const bytes = serialize(signedTx, codec.SignedTransaction);
  const hex = toHex0x(bytes);
  const result = await transport.request<string>(
    "groundhog_sendRawTransaction",
    [hex],
  );
  return hashFromHex(result);
}
```

- [ ] **Step 4: Update wallet barrel**

```ts
// src/actions/wallet/index.ts
export { sendTransaction } from "./sendTransaction.js";
```

- [ ] **Step 5: Run test**

Run: `npm test -- src/actions/actions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/actions/wallet/sendTransaction.ts src/actions/wallet/index.ts src/actions/actions.test.ts src/actions/hex.ts
git commit -m "Add sendTransaction action with hex conversion"
```

---

### Task 8: getChainTip Action

**Files:**

- Create: `src/actions/public/getChainTip.ts`
- Modify: `src/actions/public/index.ts`

- [ ] **Step 1: Add failing test to actions.test.ts**

```ts
// Append to src/actions/actions.test.ts
import { getChainTip } from "./public/getChainTip.js";

describe("getChainTip", () => {
  it("returns typed ChainTip from empty mock", async () => {
    const transport = new MockTransport();
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(0n);
    expect(tip.blockHash.length).toBe(32);
  });

  it("reflects height after sending a transaction", async () => {
    const transport = new MockTransport();
    const signed = await makeSignedTx();
    await sendTransaction(transport, signed);

    const tip = await getChainTip(transport);
    expect(tip.height).toBe(1n);
  });
});
```

- [ ] **Step 2: Implement getChainTip**

```ts
// src/actions/public/getChainTip.ts
import type { Transport } from "../../transport/types.js";
import type { ChainTip } from "../../types/rpc.js";
import { hashFromHex } from "../hex.js";

export async function getChainTip(transport: Transport): Promise<ChainTip> {
  const result = await transport.request<{ height: number; blockHash: string }>(
    "groundhog_chainTip",
  );
  return {
    height: BigInt(result.height),
    blockHash: hashFromHex(result.blockHash),
  };
}
```

- [ ] **Step 3: Update public barrel**

```ts
// src/actions/public/index.ts
export { getChainTip } from "./getChainTip.js";
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/actions/actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/actions/public/getChainTip.ts src/actions/public/index.ts src/actions/actions.test.ts
git commit -m "Add getChainTip action"
```

---

### Task 9: getTransactionReceipt and getTransactionStatus Actions

**Files:**

- Create: `src/actions/public/getTransactionReceipt.ts`
- Create: `src/actions/public/getTransactionStatus.ts`
- Modify: `src/actions/public/index.ts`

- [ ] **Step 1: Add failing tests to actions.test.ts**

```ts
// Append to src/actions/actions.test.ts
import { getTransactionReceipt } from "./public/getTransactionReceipt.js";
import { getTransactionStatus } from "./public/getTransactionStatus.js";

describe("getTransactionReceipt", () => {
  it("returns receipt for a submitted transaction", async () => {
    const transport = new MockTransport();
    const signed = await makeSignedTx();
    const hash = await sendTransaction(transport, signed);

    const receipt = await getTransactionReceipt(transport, hash);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toEqual(hash);
    expect(receipt!.status.result).toBe("ok");
    expect(receipt!.events).toEqual([]);
  });

  it("returns null for unknown transaction", async () => {
    const transport = new MockTransport();
    const fakeHash = new Uint8Array(32);
    const receipt = await getTransactionReceipt(transport, fakeHash as any);
    expect(receipt).toBeNull();
  });
});

describe("getTransactionStatus", () => {
  it("returns committed for a submitted transaction", async () => {
    const transport = new MockTransport();
    const signed = await makeSignedTx();
    const hash = await sendTransaction(transport, signed);

    const status = await getTransactionStatus(transport, hash);
    expect(status.status).toBe("committed");
  });

  it("returns unknown for missing transaction", async () => {
    const transport = new MockTransport();
    const fakeHash = new Uint8Array(32);
    const status = await getTransactionStatus(transport, fakeHash as any);
    expect(status.status).toBe("unknown");
  });
});
```

- [ ] **Step 2: Implement getTransactionReceipt**

```ts
// src/actions/public/getTransactionReceipt.ts
import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionReceipt } from "../../types/rpc.js";
import { toHex0x, hashFromHex, fromHex0x, addressFromHex } from "../hex.js";

export async function getTransactionReceipt(
  transport: Transport,
  txHash: SHA256Hash,
): Promise<TransactionReceipt | null> {
  const result = await transport.request<any>(
    "groundhog_getTransactionReceipt",
    [toHex0x(txHash)],
  );
  if (result === null) return null;

  return {
    txHash: hashFromHex(result.txHash),
    height: BigInt(result.height),
    status: result.status,
    events: (result.events ?? []).map((e: any) => ({
      contractAddress: addressFromHex(e.contractAddress),
      topics: (e.topics ?? []).map((t: string) => fromHex0x(t)),
      data: e.data ? fromHex0x(e.data) : new Uint8Array(0),
    })),
    returnData: result.returnData ? fromHex0x(result.returnData) : null,
  };
}
```

- [ ] **Step 3: Implement getTransactionStatus**

```ts
// src/actions/public/getTransactionStatus.ts
import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionStatus } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";

export async function getTransactionStatus(
  transport: Transport,
  txHash: SHA256Hash,
): Promise<TransactionStatus> {
  const result = await transport.request<TransactionStatus>(
    "groundhog_getTransactionStatus",
    [toHex0x(txHash)],
  );
  return result;
}
```

- [ ] **Step 4: Update public barrel**

```ts
// src/actions/public/index.ts
export { getChainTip } from "./getChainTip.js";
export { getTransactionReceipt } from "./getTransactionReceipt.js";
export { getTransactionStatus } from "./getTransactionStatus.js";
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/actions/actions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/actions/public/getTransactionReceipt.ts src/actions/public/getTransactionStatus.ts src/actions/public/index.ts src/actions/actions.test.ts
git commit -m "Add getTransactionReceipt and getTransactionStatus actions"
```

---

### Task 10: Dev Actions

**Files:**

- Create: `src/actions/dev/index.ts`

- [ ] **Step 1: Add failing tests**

```ts
// Append to src/actions/actions.test.ts
import { devReset, devGetAccounts } from "./dev/index.js";

describe("dev actions", () => {
  it("devReset clears state", async () => {
    const transport = new MockTransport();
    const signed = await makeSignedTx();
    await sendTransaction(transport, signed);
    await devReset(transport);

    const tip = await getChainTip(transport);
    expect(tip.height).toBe(0n);
  });

  it("devGetAccounts returns typed accounts", async () => {
    const transport = new MockTransport();
    const accounts = await devGetAccounts(transport);
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0].address.length).toBe(32);
    expect(accounts[0].publicKey.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement dev actions**

```ts
// src/actions/dev/index.ts
import type { Transport } from "../../transport/types.js";
import type { DevAccount } from "../../types/rpc.js";
import { addressFromHex, fromHex0x } from "../hex.js";

export async function devReset(transport: Transport): Promise<void> {
  await transport.request("groundhog_dev_reset");
}

export async function devGetAccounts(
  transport: Transport,
): Promise<DevAccount[]> {
  const result = await transport.request<any[]>("groundhog_dev_getAccounts");
  return result.map((a) => ({
    address: addressFromHex(a.address),
    publicKey: fromHex0x(a.publicKey),
    privateKey: fromHex0x(a.privateKey),
    storageTokens: BigInt(a.storageTokens),
  }));
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/actions/actions.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/actions/dev/index.ts src/actions/actions.test.ts
git commit -m "Add dev actions (devReset, devGetAccounts)"
```

---

### Task 11: Actions Barrel Export

**Files:**

- Modify: `src/actions/index.ts`

- [ ] **Step 1: Update barrel**

```ts
// src/actions/index.ts
export * from "./public/index.js";
export * from "./wallet/index.js";
export { devReset, devGetAccounts } from "./dev/index.js";
```

- [ ] **Step 2: Run typecheck and all tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/actions/index.ts
git commit -m "Export all actions from barrel"
```

---

### Task 12: Client Factory

**Files:**

- Modify: `src/client.ts`
- Create: `src/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/client.test.ts
import { describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  calldata,
  contractEntrypointID,
  AuthClaimType,
  bitMap,
  weight,
} from "@groundhogchain/protocol";
import { MockTransport } from "./transport/mock.js";
import { PrivateKeySigner } from "./signers/privateKey.js";
import { createInvocation, createTransaction } from "./transaction/build.js";
import { signTransaction } from "./transaction/sign.js";
import { createGroundhogClient } from "./client.js";

describe("createGroundhogClient", () => {
  it("exposes all actions as methods", async () => {
    const transport = new MockTransport();
    const client = createGroundhogClient(transport);

    const tip = await client.getChainTip();
    expect(tip.height).toBe(0n);
  });

  it("sends a transaction and retrieves its receipt", async () => {
    const transport = new MockTransport();
    const client = createGroundhogClient(transport);

    const secretKey = new Uint8Array(32);
    secretKey[0] = 0x01;
    const signer = new PrivateKeySigner(secretKey);

    const tx = createTransaction({
      invocation: createInvocation({
        invoked_address: contractAddress(new Uint8Array(32)),
        entrypoint: contractEntrypointID(new Uint8Array(8)),
        gas_limit: gasAmount(1_000_000n),
        calldata: calldata(new Uint8Array(0)),
      }),
      uniquifier: {
        block_expiry_height: blockHeight(100n),
        nonce: 1n,
      },
      contracts_to_deploy: [],
      auth_claim: {
        claim_type: AuthClaimType.kSourceAddressAuthData,
        source_address_claim: {
          allowed_keys: bitMap(0xffffffffn),
          required_weight: weight(1n),
        },
      },
    });

    const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);
    const hash = await client.sendTransaction(signed);
    expect(hash.length).toBe(32);

    const receipt = await client.getTransactionReceipt(hash);
    expect(receipt).not.toBeNull();
    expect(receipt!.status.result).toBe("ok");
  });

  it("exposes dev namespace", async () => {
    const transport = new MockTransport();
    const client = createGroundhogClient(transport);

    const accounts = await client.dev.getAccounts();
    expect(accounts.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement createGroundhogClient**

```ts
// src/client.ts
import type { Transport } from "./transport/types.js";
import type { SHA256Hash, SignedTransaction } from "@groundhogchain/protocol";
import type {
  ChainTip,
  TransactionReceipt,
  TransactionStatus,
  DevAccount,
} from "./types/rpc.js";
import { getChainTip } from "./actions/public/getChainTip.js";
import { getTransactionReceipt } from "./actions/public/getTransactionReceipt.js";
import { getTransactionStatus } from "./actions/public/getTransactionStatus.js";
import { sendTransaction } from "./actions/wallet/sendTransaction.js";
import { devReset, devGetAccounts } from "./actions/dev/index.js";

export interface GroundhogClient {
  getChainTip(): Promise<ChainTip>;
  getTransactionReceipt(txHash: SHA256Hash): Promise<TransactionReceipt | null>;
  getTransactionStatus(txHash: SHA256Hash): Promise<TransactionStatus>;
  sendTransaction(signedTx: SignedTransaction): Promise<SHA256Hash>;
  dev: {
    reset(): Promise<void>;
    getAccounts(): Promise<DevAccount[]>;
  };
}

export function createGroundhogClient(transport: Transport): GroundhogClient {
  return {
    getChainTip: () => getChainTip(transport),
    getTransactionReceipt: (txHash) => getTransactionReceipt(transport, txHash),
    getTransactionStatus: (txHash) => getTransactionStatus(transport, txHash),
    sendTransaction: (signedTx) => sendTransaction(transport, signedTx),
    dev: {
      reset: () => devReset(transport),
      getAccounts: () => devGetAccounts(transport),
    },
  };
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/client.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/client.ts src/client.test.ts
git commit -m "Add createGroundhogClient factory"
```

---

### Task 13: Root Barrel Exports and Build Config

**Files:**

- Modify: `src/index.ts`
- Modify: `tsup.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Update root barrel**

```ts
// src/index.ts
export * from "./transaction/index.js";
export * from "./contract/index.js";
export * from "./actions/index.js";
export type { Transport } from "./transport/index.js";
export {
  HttpTransport,
  JsonRpcError,
  MockTransport,
} from "./transport/index.js";
export type { Signer } from "./signers/index.js";
export { PrivateKeySigner } from "./signers/index.js";
export { createGroundhogClient } from "./client.js";
export type { GroundhogClient } from "./client.js";
export type * from "./types/rpc.js";
```

- [ ] **Step 2: Add types entry to tsup and package.json if needed**

Check if the types sub-path is already configured. If `src/types/rpc.ts` needs its own entry point, add it. Otherwise the root barrel re-export is sufficient.

- [ ] **Step 3: Run full suite**

Run: `npm run format:check && npm run typecheck && npm test && npm run build`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts tsup.config.ts package.json
git commit -m "Export client, actions, transport, and RPC types from root"
```

---

### Task 14: Full Pipeline E2E Test

**Files:**

- Modify: `src/e2e.test.ts`

Add a test that exercises the complete flow: build tx with generated ERC20 bindings → sign → send via client with MockTransport → get receipt.

- [ ] **Step 1: Add client-based e2e test**

```ts
// Append to src/e2e.test.ts (add imports and new describe block)
import { MockTransport } from "./transport/mock.js";
import { createGroundhogClient } from "./client.js";

describe("end-to-end: client with MockTransport", () => {
  it("sends an ERC20 transfer and gets a receipt", async () => {
    const transport = new MockTransport();
    const client = createGroundhogClient(transport);

    // Set up signer
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xab;
    const signer = new PrivateKeySigner(secretKey);

    // Build transaction using generated ERC20 bindings
    const tokenAddress = contractAddress(new Uint8Array(32).fill(0x11));
    const recipient = contractAddress(new Uint8Array(32).fill(0x22));

    // Import transfer from generated bindings
    const { transfer } = await import("./contracts/erc20.js");
    const invocation = transfer(tokenAddress, gasAmount(1_000_000n), {
      to: recipient,
      amount: 100n,
    });

    const tx = createTransaction({
      invocation,
      uniquifier: {
        block_expiry_height: blockHeight(1000n),
        nonce: 1n,
      },
      contracts_to_deploy: [],
      auth_claim: {
        claim_type: AuthClaimType.kSourceAddressAuthData,
        source_address_claim: {
          allowed_keys: bitMap(0xffffffffn),
          required_weight: weight(1n),
        },
      },
    });

    const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);

    // Send via client
    const hash = await client.sendTransaction(signed);
    expect(hash.length).toBe(32);

    // Get receipt
    const receipt = await client.getTransactionReceipt(hash);
    expect(receipt).not.toBeNull();
    expect(receipt!.status.result).toBe("ok");

    // Chain tip reflects the new block
    const tip = await client.getChainTip();
    expect(tip.height).toBe(1n);
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npm run typecheck && npm test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/e2e.test.ts
git commit -m "Add client + MockTransport e2e test with ERC20 transfer"
```

---

### Task 15: Check in OpenRPC Spec and Regen Script

**Files:**

- Create: `specs/openrpc.json` (already created, needs to be committed)
- Create: `scripts/regen-openrpc.sh` (already created, needs to be committed)

- [ ] **Step 1: Commit spec and script**

```bash
git add specs/openrpc.json scripts/regen-openrpc.sh
git commit -m "Check in OpenRPC spec and regeneration script"
```

---

### Task 16: Final Verification and PR

- [ ] **Step 1: Format**

Run: `npm run format`

- [ ] **Step 2: Full verification**

Run: `npm run format:check && npm run typecheck && npm test && npm run build`
Expected: ALL PASS

- [ ] **Step 3: Commit any formatting changes and create PR**

```bash
git add -A
git commit -m "Format"
gh pr create --title "Add transport, mock, actions, and client factory" --body "..."
```
