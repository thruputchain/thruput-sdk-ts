import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { codec, deserialize } from "@thruputchain/protocol";
import spec from "../../specs/native-openrpc.json";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x, toHex0x } from "../actions/hex.js";
import { toBase58 } from "../encoding.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { RpcResponseError } from "../transport/responseError.js";
import { HttpTransport, JsonRpcError } from "../transport/http.js";
import {
  createRpcClient,
  RpcCompatibilityError,
  type RpcMethod,
} from "./client.js";
import {
  decodeResult,
  encodeRequest,
  RpcDecodingError,
  RpcRequestValidationError,
  UnsupportedRpcValue,
} from "./codec.js";
import { NativeRpcError } from "./errorReader.js";
import type { RpcRequests } from "./generated.js";

const address = new Uint8Array(32).fill(1);
const base58 = toBase58(address);
const signedTransaction = fromHex0x(
  "0x" + vectors.signing[0]!.signed_transaction_xdr,
);
const hash = hashSignedTransaction(
  deserialize(signedTransaction, codec.SignedTransaction),
);
const hashText = toBase58(hash);
const start = { order: "ascending", anchor: { kind: "atBeginning" } } as const;
const invocation = {
  address,
  entrypoint: new Uint8Array(8),
  calldata: new Uint8Array([1]),
  gasLimit: 7n,
};
const params: RpcRequests = {
  getVersionInfo: {},
  getNetworkInfo: {},
  getChainTip: {},
  getChainConfig: {},
  getServerLimits: {},
  sendTransaction: { signedTransaction },
  getTransactionStatus: { transactionHash: hash },
  getTransactionReceipt: { transactionHash: hash },
  simulateInvocation: invocation,
  simulateInvocations: { invocations: [invocation] },
  getStorage: { address, key: new Uint8Array([1]) },
  getBalance: { address },
  getRegisteredAuth: { address },
  getEvents: {
    filters: [
      { addresses: [address], topics: { topic0: [new Uint8Array(32)] } },
    ],
    start,
    limit: 2,
  },
  getTransactionsByRootAddress: { address, start, limit: 2 },
  getBlockByHeight: { blockHeight: 5n },
  getTransactionsByBlock: {
    blockHeight: 5n,
    start: { order: "ascending" },
    limit: 2,
  },
  faucet_requestAirdrop: {
    recipient: address,
    clientNonce: new Uint8Array([1]),
  },
  dev_fundAccount: {
    recipient: address,
    faucet: address,
    clientNonce: new Uint8Array([1]),
    rawAmount: 7n,
  },
  dev_getPendingTransactionCount: {},
};
const receipt = {
  transactionHash: hashText,
  blockHeight: "5",
  execution: { result: "return", returnData: "0x" },
  events: [],
  gasUsed: "7",
};
const bounds = {
  oldestIndexedBlockHeight: "1",
  latestIndexedBlockHeight: "6",
  nextCursor: null,
};
const wire: Record<RpcMethod, unknown> = {
  getVersionInfo: {
    wireFormat: "14.0.0",
    implementation: "test",
    supportedMethods: spec.methods.map((m) => m.name),
  },
  getNetworkInfo: { networkHash: base58 },
  getChainTip: { blockHeight: "5", blockHash: base58 },
  getChainConfig: { stated: { maxNewContractsPerTx: 5 } },
  getServerLimits: {
    maxSimulationGas: "1000000",
    maxSimulationCalldataBytes: "65536",
    maxEventsPerPage: 200,
    maxTransactionsPerPage: 200,
    maxCursorBytes: "256",
    simulationBatch: {
      maxInvocations: 16,
      maxCalldataBytes: 65536,
      maxGas: "16000000",
      maxBackendResponseBytes: 1000000,
      timeoutMs: "3000",
    },
  },
  sendTransaction: { transactionHash: hashText, admission: "accepted" },
  getTransactionStatus: { status: "committed", blockHeight: "5" },
  getTransactionReceipt: receipt,
  simulateInvocation: {
    stateBlockHeight: "5",
    output: { result: "return", returnData: "0x" },
    events: [],
    gasUsed: "7",
  },
  simulateInvocations: {
    stateBlockHeight: "5",
    results: [
      {
        output: { result: "return", returnData: "0x" },
        events: [],
        gasUsed: "7",
      },
    ],
  },
  getStorage: {
    stateBlockHeight: "5",
    item: { kind: "bytestring", bytes: "0x01" },
  },
  getBalance: { address: base58, stateBlockHeight: "5", rawBalance: "700" },
  getRegisteredAuth: {
    address: base58,
    stateBlockHeight: "5",
    configuration: {
      signers: [
        {
          keyId: 9,
          publicKey: { scheme: "ed25519", key: base58 },
          maxWeight: 1,
        },
      ],
      requiredWeight: 1,
    },
  },
  getEvents: {
    ...bounds,
    events: [
      {
        transactionHash: hashText,
        blockHeight: "5",
        sequenceNumber: 0,
        event: {
          address: base58,
          topics: ["0x" + "00".repeat(32)],
          data: "0x",
        },
      },
    ],
  },
  getTransactionsByRootAddress: {
    ...bounds,
    transactions: [{ transactionHash: hashText, blockHeight: "5" }],
  },
  getBlockByHeight: {
    blockHeight: "5",
    blockHash: base58,
    blockTimepoint: "12",
    configHash: base58,
    eventsHash: base58,
    networkHash: base58,
    prevBlockHash: base58,
    proposalTxsHash: base58,
    proposer: base58,
    protocol: 1,
    storageHash: base58,
    txsHash: base58,
    upgrades: [],
  },
  getTransactionsByBlock: {
    ...bounds,
    transactions: [{ transactionHash: hashText, blockHeight: "5" }],
  },
  faucet_requestAirdrop: {
    attemptStatus: "pending",
    recipient: base58,
    rawAmount: "7",
    retryAfterSeconds: "1",
    transactionHash: hashText,
  },
  dev_fundAccount: {
    recipient: base58,
    rawAmount: "7",
    transactionHash: hashText,
    signedTransaction: toHex0x(signedTransaction),
  },
  dev_getPendingTransactionCount: { count: "2" },
};

function server(
  overrides: Partial<Record<RpcMethod, unknown>> = {},
  batch = false,
) {
  const results = { ...structuredClone(wire), ...overrides };
  const calls: { method: RpcMethod; params: Record<string, unknown> }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
    const body = JSON.parse(String(init?.body));
    const respond = (request: {
      id: number;
      method: RpcMethod;
      params: Record<string, unknown>;
    }) => {
      calls.push(request);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: results[request.method],
      };
    };
    return Response.json(
      Array.isArray(body) ? body.map(respond).reverse() : respond(body),
    );
  });
  return {
    results,
    calls,
    fetch,
    transport: new HttpTransport("https://rpc.test", { fetch, batch }),
  };
}

describe("native RPC client", () => {
  it.each(["Uint8Array", "Buffer"])(
    "snapshots %s expected network before initial discovery",
    async (kind) => {
      const expected =
        kind === "Buffer" ? Buffer.from(address) : new Uint8Array(address);
      const endpoint = server();
      const connecting = createRpcClient({
        transport: endpoint.transport,
        expectedNetworkHash: expected,
      });
      expected.fill(2);
      expect((await connecting).discovery.network.networkHash).toEqual(address);
    },
  );
  it.each(["Uint8Array", "Buffer"])(
    "does not let %s mutation retarget discovery refresh",
    async (kind) => {
      const expected =
        kind === "Buffer" ? Buffer.from(address) : new Uint8Array(address);
      const endpoint = server();
      const client = await createRpcClient({
        transport: endpoint.transport,
        expectedNetworkHash: expected,
      });
      expected.fill(2);
      endpoint.results.getNetworkInfo = { networkHash: toBase58(expected) };
      await expect(client.refreshDiscovery()).rejects.toBeInstanceOf(
        RpcCompatibilityError,
      );
      expect(client.discovery.network.networkHash).toEqual(address);
    },
  );
  it("sends all 20 named calls and validates their request/result fixtures against the Rust schema", async () => {
    const endpoint = server({}, true);
    const client = await createRpcClient({
      transport: endpoint.transport,
      expectedNetworkHash: address,
    });
    const ajv = new Ajv({ strict: false, validateFormats: false });
    for (const method of spec.methods) {
      const name = method.name as RpcMethod;
      // Dynamic catalog coverage; consumer-shaped types are checked separately.
      const invoke = client[name] as (request: unknown) => Promise<unknown>;
      const result = await invoke(params[name]);
      expect(result).not.toBeUndefined();
      const call = endpoint.calls.at(-1)!;
      expect(call.method).toBe(name);
      expect(Array.isArray(call.params)).toBe(false);
      const validate = ajv.compile({
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          method.params.map((p) => [p.name, p.schema]),
        ),
        required: method.params
          .filter((p) => "required" in p && p.required)
          .map((p) => p.name),
        components: spec.components,
      });
      expect(validate(call.params), JSON.stringify(validate.errors)).toBe(true);
      const validateResult = ajv.compile({
        ...method.result.schema,
        components: spec.components,
      });
      expect(
        validateResult(wire[name]),
        JSON.stringify(validateResult.errors),
      ).toBe(true);
    }
    expect(await client.getChainTip()).toEqual({
      blockHeight: 5n,
      blockHash: address,
    });
    expect(
      await client.getTransactionReceipt({ transactionHash: hash }),
    ).toMatchObject({
      blockHeight: 5n,
      execution: { result: "return", returnData: new Uint8Array() },
      gasUsed: 7n,
    });
  });
  it("preserves every unknown variant and nested payload without guessing a known outcome", () => {
    for (const [method, raw] of [
      ["getTransactionStatus", { status: "future", nested: { arr: [1, 2] } }],
      [
        "getTransactionReceipt",
        { ...receipt, execution: { result: "future", detail: { a: 3 } } },
      ],
      [
        "simulateInvocation",
        {
          ...(wire.simulateInvocation as object),
          output: { result: "future", detail: 1 },
        },
      ],
      [
        "getStorage",
        { stateBlockHeight: "5", item: { kind: "future", detail: { x: 1 } } },
      ],
      ["faucet_requestAirdrop", { attemptStatus: "future", detail: 1 }],
      ["sendTransaction", { transactionHash: hashText, admission: "future" }],
    ] as const) {
      const decoded = decodeResult(method, raw) as
        | Record<string, unknown>
        | UnsupportedRpcValue;
      const unknown =
        decoded instanceof UnsupportedRpcValue
          ? decoded
          : (decoded.execution ??
            decoded.output ??
            decoded.item ??
            decoded.admission);
      expect(unknown).toBeInstanceOf(UnsupportedRpcValue);
      expect((unknown as UnsupportedRpcValue).raw).toEqual(
        "execution" in raw
          ? raw.execution
          : "output" in raw
            ? raw.output
            : "item" in raw
              ? raw.item
              : "admission" in raw
                ? raw.admission
                : raw,
      );
    }
  });
  it("rejects malformed known data while retaining the complete raw result", () => {
    for (const raw of [
      { ...receipt, execution: { result: "return" } },
      { ...receipt, blockHeight: 5 },
      { ...receipt, blockHeight: "05" },
      { ...receipt, transactionHash: "1" },
      { ...receipt, execution: { result: "abort", abortData: "0xAB" } },
    ]) {
      try {
        decodeResult("getTransactionReceipt", raw);
        throw new Error("expected invalid result");
      } catch (error) {
        expect(error).toBeInstanceOf(RpcDecodingError);
        expect((error as RpcDecodingError).raw).toBe(raw);
      }
    }
  });
  it("requires exact initial/continuation shapes, canonical widths and named fields", () => {
    for (const input of [
      { address, start, cursor: "0x01" },
      { address },
      { address, cursor: "0x" },
      { address, start, limit: 0 },
      { address, start, unexpected: 1 },
    ])
      expect(() =>
        encodeRequest("getTransactionsByRootAddress", input),
      ).toThrow();
    expect(() =>
      encodeRequest("getBlockByHeight", { blockHeight: 5 }),
    ).toThrow();
    expect(() =>
      encodeRequest("getBlockByHeight", { blockHeight: 1n << 63n }),
    ).toThrow();
    expect(() =>
      encodeRequest("simulateInvocation", { ...invocation, contract: address }),
    ).toThrow();
    expect(() =>
      encodeRequest("simulateInvocation", { ...invocation, gasLimit: 0n }),
    ).toThrow();
    expect(() =>
      encodeRequest("getEvents", { filters: [{ addresses: [] }], start }),
    ).toThrow();
    expect(() =>
      encodeRequest("faucet_requestAirdrop", {
        recipient: address,
        clientNonce: new Uint8Array(),
      }),
    ).toThrow();
    expect(
      encodeRequest("getTransactionsByRootAddress", {
        address,
        cursor: "0x1234",
      }),
    ).toEqual({ address: base58, cursor: "0x1234" });
  });
  it("gates wire, required methods and network before making an application call", async () => {
    for (const [override, options] of [
      [
        {
          getVersionInfo: {
            ...(wire.getVersionInfo as object),
            wireFormat: "13.0.0",
          },
        },
        {},
      ],
      [
        {
          getVersionInfo: {
            ...(wire.getVersionInfo as object),
            supportedMethods: ["getVersionInfo", "getNetworkInfo"],
          },
        },
        { requiredMethods: ["sendTransaction"] as const },
      ],
      [{}, { expectedNetworkHash: new Uint8Array(32) }],
    ] as const) {
      const endpoint = server(override);
      await expect(
        createRpcClient({ transport: endpoint.transport, ...options }),
      ).rejects.toBeInstanceOf(RpcCompatibilityError);
      expect(endpoint.calls.some((c) => c.method === "sendTransaction")).toBe(
        false,
      );
    }
  });
  it("omits unconfigured optional operations and preserves an atomic discovery snapshot", async () => {
    const endpoint = server({
      getVersionInfo: {
        ...(wire.getVersionInfo as object),
        supportedMethods: ["getVersionInfo", "getNetworkInfo", "getChainTip"],
      },
    });
    const client = await createRpcClient({ transport: endpoint.transport });
    await expect(
      client.faucet_requestAirdrop(params.faucet_requestAirdrop),
    ).rejects.toThrow("does not advertise");
    const snapshot = client.discovery;
    snapshot.version.supportedMethods.push("faucet_requestAirdrop");
    snapshot.network.networkHash.fill(9);
    await expect(
      client.faucet_requestAirdrop(params.faucet_requestAirdrop),
    ).rejects.toThrow("does not advertise");
    endpoint.results.getNetworkInfo = {
      networkHash: toBase58(new Uint8Array(32).fill(2)),
    };
    await expect(client.refreshDiscovery()).rejects.toThrow("network identity");
    expect(client.discovery.network.networkHash).toEqual(address);
    endpoint.results.getNetworkInfo = wire.getNetworkInfo;
    endpoint.results.getVersionInfo = wire.getVersionInfo;
    await client.refreshDiscovery();
    expect(client.discovery.version.supportedMethods).toContain(
      "faucet_requestAirdrop",
    );
  });
  it("keeps raw RPC errors and never repeats writes or refreshes discovery on errors", async () => {
    const endpoint = server();
    const client = await createRpcClient({ transport: endpoint.transport });
    const data = {
      kind: "future",
      nested: { admission: "accepted", reason: "future" },
    };
    endpoint.fetch.mockImplementation(async (_, init) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -31999, message: "future", data },
      });
    });
    const count = endpoint.fetch.mock.calls.length;
    try {
      await client.sendTransaction({ signedTransaction });
      throw new Error("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonRpcError);
      expect((error as JsonRpcError).data).toEqual(data);
    }
    expect(endpoint.fetch).toHaveBeenCalledTimes(count + 1);
  });
  it("enforces response identity, page caps and non-progress without rejecting empty nonterminal pages", async () => {
    const endpoint = server();
    const client = await createRpcClient({ transport: endpoint.transport });
    await expect(
      client.getEvents({ ...params.getEvents, limit: 201 }),
    ).rejects.toThrow("cap");
    endpoint.results.getEvents = { ...bounds, nextCursor: "0x01", events: [] };
    expect((await client.getEvents(params.getEvents)).nextCursor).toBe("0x01");
    await expect(
      client.getEvents({ filters: params.getEvents.filters, cursor: "0x01" }),
    ).rejects.toBeInstanceOf(RpcDecodingError);
    endpoint.results.getTransactionReceipt = {
      ...receipt,
      transactionHash: base58,
    };
    await expect(
      client.getTransactionReceipt({ transactionHash: hash }),
    ).rejects.toBeInstanceOf(RpcDecodingError);
    endpoint.results.getTransactionsByBlock = {
      ...bounds,
      transactions: [{ transactionHash: hashText, blockHeight: "4" }],
    };
    await expect(
      client.getTransactionsByBlock(params.getTransactionsByBlock),
    ).rejects.toBeInstanceOf(RpcDecodingError);
    endpoint.results.sendTransaction = {
      transactionHash: base58,
      admission: "accepted",
    };
    await expect(
      client.sendTransaction({ signedTransaction }),
    ).rejects.toBeInstanceOf(RpcDecodingError);
  });
  it("uses object params in reordered HTTP batches and preserves per-call cancellation", async () => {
    const endpoint = server({}, true);
    const client = await createRpcClient({ transport: endpoint.transport });
    const controller = new AbortController();
    const cancelled = client.getChainTip({}, { signal: controller.signal });
    const balance = client.getBalance({ address });
    controller.abort(new Error("cancelled"));
    await expect(cancelled).rejects.toThrow("cancelled");
    expect((await balance).rawBalance).toBe(700n);
    const [tip, status] = await Promise.all([
      client.getChainTip(),
      client.getTransactionStatus({ transactionHash: hash }),
    ]);
    expect(tip.blockHeight).toBe(5n);
    expect(status).toEqual({ status: "committed", blockHeight: 5n });
  });
  it("rejects mismatched single-call HTTP IDs before interpreting success", async () => {
    const transport = new HttpTransport("https://rpc.test", {
      fetch: async () =>
        Response.json({ jsonrpc: "2.0", id: 99, result: wire.getVersionInfo }),
    });
    await expect(createRpcClient({ transport })).rejects.toThrow("request ID");
  });
  it("retains null-ID framework errors without treating them as method success", async () => {
    const data = { parser: { offset: 7 } };
    const transport = new HttpTransport("https://rpc.test", {
      fetch: async () =>
        Response.json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "invalid request", data },
        }),
    });
    try {
      await createRpcClient({ transport });
      throw new Error("expected RPC failure");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonRpcError);
      expect((error as JsonRpcError).data).toEqual(data);
    }
  });
  it("separates local validation from dispatched response failures and keeps malformed funding evidence", async () => {
    const endpoint = server();
    const client = await createRpcClient({ transport: endpoint.transport });
    const count = endpoint.calls.length;
    for (const request of [
      { signedTransaction: new Uint8Array([1]) },
      { signedTransaction, typo: true },
    ]) {
      try {
        await client.sendTransaction(request);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(RpcRequestValidationError);
        expect(error).not.toHaveProperty("raw");
      }
    }
    expect(endpoint.calls).toHaveLength(count);
    const raw = {
      ...(wire.dev_fundAccount as object),
      signedTransaction: "0x01",
    };
    endpoint.results.dev_fundAccount = raw;
    try {
      await client.dev_fundAccount(params.dev_fundAccount);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(RpcDecodingError);
      expect((error as RpcDecodingError).raw).toEqual(raw);
    }
    expect(endpoint.calls).toHaveLength(count + 1);
  });
  it("binds known error evidence to the invoked method and requested hash", async () => {
    const endpoint = server();
    const client = await createRpcClient({ transport: endpoint.transport });
    for (const transactionHash of [hashText, base58]) {
      const raw = {
        code: -32051,
        message: "timed out",
        data: {
          kind: "backendTimeout",
          admission: "notAttempted",
          transactionHash,
        },
        extra: 1,
      };
      endpoint.fetch.mockImplementation(async (_, init) => {
        const call = JSON.parse(String(init?.body));
        return Response.json({ jsonrpc: "2.0", id: call.id, error: raw });
      });
      try {
        await client.sendTransaction({ signedTransaction });
        throw new Error("expected error");
      } catch (error) {
        expect(error).toBeInstanceOf(NativeRpcError);
        expect((error as NativeRpcError).raw).toEqual(raw);
        expect((error as NativeRpcError).decoded.classification).toBe(
          transactionHash === hashText ? "known" : "unclassified",
        );
      }
    }
    expect(endpoint.fetch).toHaveBeenCalledTimes(5); // Three discovery reads, two explicit writes.
  });
  it("rejects missing history ranges, duplicate identities and wrong directions", async () => {
    const endpoint = server();
    const client = await createRpcClient({ transport: endpoint.transport });
    const tx = { transactionHash: hashText, blockHeight: "5" };
    const request = {
      address,
      start: {
        order: "ascending",
        anchor: { kind: "atHeight", blockHeight: 4n },
      },
    } as const;
    for (const page of [
      { ...bounds, oldestIndexedBlockHeight: "5", transactions: [tx] },
      { ...bounds, transactions: [{ ...tx, blockHeight: "3" }] },
      { ...bounds, transactions: [tx, { ...tx, blockHeight: "6" }] },
      {
        ...bounds,
        transactions: [
          { ...tx, blockHeight: "6" },
          { transactionHash: base58, blockHeight: "5" },
        ],
      },
    ]) {
      endpoint.results.getTransactionsByRootAddress = page;
      await expect(
        client.getTransactionsByRootAddress(request),
      ).rejects.toBeInstanceOf(RpcDecodingError);
    }
    const event = (wire.getEvents as { events: object[] }).events[0]!;
    for (const page of [
      { ...bounds, events: [event, event] },
      {
        ...bounds,
        events: [
          {
            ...event,
            event: {
              address: toBase58(new Uint8Array(32).fill(2)),
              topics: [],
              data: "0x",
            },
          },
        ],
      },
      {
        ...bounds,
        events: [
          {
            ...event,
            event: {
              address: base58,
              topics: ["0x" + "01".repeat(32)],
              data: "0x",
            },
          },
        ],
      },
    ]) {
      endpoint.results.getEvents = page;
      await expect(client.getEvents(params.getEvents)).rejects.toBeInstanceOf(
        RpcDecodingError,
      );
    }
    for (const page of [
      { ...bounds, nextCursor: "0x01", transactions: [] },
      { ...bounds, oldestIndexedBlockHeight: "0", transactions: [] },
      { ...bounds, oldestIndexedBlockHeight: "6", transactions: [] },
    ]) {
      endpoint.results.getTransactionsByBlock = page;
      await expect(
        client.getTransactionsByBlock({ blockHeight: 5n, cursor: "0x02" }),
      ).rejects.toBeInstanceOf(RpcDecodingError);
    }
  });
  it("rejects a block from another network and preserves discovery on invalid refresh", async () => {
    const endpoint = server();
    const client = await createRpcClient({
      transport: endpoint.transport,
      requiredMethods: ["getBalance"],
    });
    endpoint.results.getBlockByHeight = {
      ...(wire.getBlockByHeight as object),
      networkHash: hashText,
    };
    await expect(
      client.getBlockByHeight({ blockHeight: 5n }),
    ).rejects.toBeInstanceOf(RpcDecodingError);
    const previous = client.discovery;
    for (const version of [
      { ...(wire.getVersionInfo as object), wireFormat: "15.0.0" },
      {
        ...(wire.getVersionInfo as object),
        supportedMethods: ["getVersionInfo", "getNetworkInfo"],
      },
    ]) {
      endpoint.results.getVersionInfo = version;
      await expect(client.refreshDiscovery()).rejects.toBeInstanceOf(
        RpcCompatibilityError,
      );
      expect(client.discovery).toEqual(previous);
    }
  });
  it("does not repeat a write cancelled after a batch was dispatched", async () => {
    const endpoint = server({}, true);
    const client = await createRpcClient({ transport: endpoint.transport });
    let complete!: () => void;
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    endpoint.fetch.mockImplementation(async (_, init) => {
      const calls = JSON.parse(String(init?.body)) as {
        id: number;
        method: RpcMethod;
      }[];
      dispatched();
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      return Response.json(
        calls
          .map((call) => ({
            jsonrpc: "2.0",
            id: call.id,
            result: wire[call.method],
          }))
          .reverse(),
      );
    });
    const controller = new AbortController();
    const write = client.sendTransaction(
      { signedTransaction },
      { signal: controller.signal },
    );
    const read = client.getChainTip();
    await started;
    controller.abort(new Error("cancelled after dispatch"));
    await expect(write).rejects.toThrow("cancelled after dispatch");
    complete();
    expect((await read).blockHeight).toBe(5n);
    expect(endpoint.fetch).toHaveBeenCalledTimes(4); // Discovery plus one shared batch.
  });
  it("retains malformed dispatched reply envelopes for individual and batched writes", async () => {
    for (const batch of [false, true]) {
      for (const shape of ["id", "version", "code", "count"]) {
        const endpoint = server({}, batch);
        const client = await createRpcClient({ transport: endpoint.transport });
        let raw: unknown;
        endpoint.fetch.mockImplementation(async (_, init) => {
          const body = JSON.parse(String(init?.body));
          const call = batch ? body[0] : body;
          const reply = {
            jsonrpc: shape === "version" ? "bad" : "2.0",
            id: shape === "id" ? 999 : call.id,
            error: {
              code: shape === "code" ? -32051.5 : -32051,
              message: "failed",
              data: { kind: "backendTimeout", admission: "unknown" },
            },
          };
          raw = batch
            ? shape === "count"
              ? []
              : [reply]
            : shape === "count"
              ? null
              : reply;
          return Response.json(raw);
        });
        try {
          await client.sendTransaction({ signedTransaction });
          throw new Error("expected failure");
        } catch (error) {
          expect(error).toBeInstanceOf(RpcResponseError);
          // Per-call malformed data retains that envelope; invalid batch structure retains the array.
          expect((error as RpcResponseError).raw).toEqual(
            batch && shape === "code" ? (raw as unknown[])[0] : raw,
          );
        }
        expect(endpoint.fetch).toHaveBeenCalledTimes(4);
      }
    }
  });
  it("rejects a non-null block at the uncommitted height zero", async () => {
    const endpoint = server({
      getBlockByHeight: {
        ...(wire.getBlockByHeight as object),
        blockHeight: "0",
      },
    });
    const client = await createRpcClient({ transport: endpoint.transport });
    await expect(
      client.getBlockByHeight({ blockHeight: 0n }),
    ).rejects.toBeInstanceOf(RpcDecodingError);
  });
});

it("additive page fields cannot change the requested method's validation", async () => {
  const endpoint = server({
    getEvents: {
      ...bounds,
      events: [
        {
          transactionHash: hashText,
          blockHeight: "5",
          sequenceNumber: 0,
          event: { address: base58, topics: [], data: "0x" },
        },
      ],
      transactions: [{ transactionHash: hashText, blockHeight: "999" }],
    },
    getTransactionsByRootAddress: {
      ...bounds,
      transactions: [{ transactionHash: hashText, blockHeight: "5" }],
      events: [],
    },
  });
  const client = await createRpcClient({ transport: endpoint.transport });
  await expect(
    client.getEvents({ filters: [{ addresses: [address] }], start }),
  ).resolves.toMatchObject({ events: [{ blockHeight: 5n }] });
  await expect(
    client.getTransactionsByRootAddress({ address, start }),
  ).resolves.toMatchObject({ transactions: [{ blockHeight: 5n }] });
});
