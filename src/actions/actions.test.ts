import { assert, describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  calldata,
  contractEntrypointID,
  AuthClaimType,
  bitMap,
  weight,
  ExecResult,
  sha256Hash,
  networkHash,
} from "@groundhogchain/protocol";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createInvocation, createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import { MockTransport } from "../transport/mock.js";
import { sendTransaction } from "./wallet/sendTransaction.js";
import { getChainTip } from "./public/getChainTip.js";
import { getNetworkInfo } from "./public/getNetworkInfo.js";
import { getBalance } from "./public/getBalance.js";
import { getBlockByNumber } from "./public/getBlockByNumber.js";
import { getPendingTransactionCount } from "./public/getPendingTransactionCount.js";
import {
  getTransactionReceipt,
  InvalidTransactionReceiptError,
} from "./public/getTransactionReceipt.js";
import { getTransactionStatus } from "./public/getTransactionStatus.js";
import { getTransactionsByAddress } from "./public/getTransactionsByAddress.js";
import { getEvents } from "./public/getEvents.js";
import { getStorageAt } from "./public/getStorageAt.js";
import { getVersion } from "./public/getVersion.js";
import { view } from "./public/view.js";
import type { Transport } from "../transport/types.js";
import { hashFromHex } from "./hex.js";

const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0x5a)));

function makeDummySignedTx() {
  const secretKey = new Uint8Array(32);
  secretKey[0] = 1;
  const signer = new PrivateKeySigner(secretKey);

  const invocation = createInvocation({
    invoked_address: contractAddress(new Uint8Array(32)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3, 4])),
  });

  const tx = createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(100n),
      nonce: 42n,
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

  return signTransaction(tx, [{ signer, publicKeyId: 0n }], testNetworkHash);
}

describe("sendTransaction", () => {
  it("sends a signed tx and returns a 32-byte hash", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const hash = await sendTransaction(transport, signedTx);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });
});

describe("getChainTip", () => {
  it("returns height 0n and 32-byte blockHash on empty mock", async () => {
    const transport = new MockTransport();
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(0n);
    expect(tip.blockHash).toBeInstanceOf(Uint8Array);
    expect(tip.blockHash.length).toBe(32);
  });

  it("reflects height 1n after sending a transaction", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(1n);
  });
});

describe("getNetworkInfo", () => {
  it("requests immutable network identity without parameters", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          networkHash: "0x" + "cd".repeat(32),
          futureField: true,
        } as T;
      },
    };

    const network = await getNetworkInfo(transport);

    expect(calls).toEqual([
      { method: "groundhog_networkInfo", params: undefined },
    ]);
    expect(network.networkHash).toEqual(new Uint8Array(32).fill(0xcd));
  });

  it("returns localnet identity from the mock transport", async () => {
    const network = await getNetworkInfo(new MockTransport());

    expect(network.networkHash).toEqual(new Uint8Array(32));
  });

  it.each([
    null,
    {},
    { networkHash: "" },
    { networkHash: "00".repeat(32) },
    { networkHash: "0x" + "AA".repeat(32) },
    { networkHash: "0x00" },
  ])("rejects malformed network identity: %j", async (result) => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return result as T;
      },
    };

    await expect(getNetworkInfo(transport)).rejects.toThrow(
      /Invalid network info response/,
    );
  });
});

describe("getVersion", () => {
  it("returns version info from mock", async () => {
    const transport = new MockTransport();
    const version = await getVersion(transport);
    expect(version).toEqual({
      wireFormat: "3.3.0",
      implementation: "mock",
      commitHash: null,
      platformVersion: null,
      releaseVersion: null,
      bundleManifestDigest: null,
    });
  });
});

describe("getBalance", () => {
  it("serializes address and parses native HOG balance response", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const address = contractAddress(new Uint8Array(32).fill(0xab));
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          address: "0x" + "ab".repeat(32),
          rawBalance: "9007199254740993",
          height: "42",
        } as T;
      },
    };

    const balance = await getBalance(transport, address);

    expect(calls).toEqual([
      { method: "groundhog_getBalance", params: ["0x" + "ab".repeat(32)] },
    ]);
    expect(balance.address).toEqual(address);
    expect(balance.rawBalance).toBe(9007199254740993n);
    expect(balance.height).toBe(42n);
  });

  it("returns zero balance from mock", async () => {
    const transport = new MockTransport();
    const address = contractAddress(new Uint8Array(32).fill(0xcd));

    const balance = await getBalance(transport, address);

    expect(balance.address).toEqual(address);
    expect(balance.rawBalance).toBe(0n);
    expect(balance.height).toBe(0n);
  });
});

describe("getBlockByNumber", () => {
  it("returns block info for an existing mock block", async () => {
    const transport = new MockTransport();
    const block = await getBlockByNumber(transport, 0n);

    expect(block).not.toBeNull();
    expect(block!.blockHash.length).toBe(32);
    expect(block!.protocol).toBe(0n);
    expect(block!.networkHash).toEqual(new Uint8Array(32));
    expect(block!.proposer).toEqual(new Uint8Array(32));
    expect(block!.blockTimepoint).toBe(0n);
    expect(block!.blockHeight).toBe(0n);
    expect(block!.txsHash.length).toBe(32);
    expect(block!.storageHash.length).toBe(32);
    expect(block!.eventsHash.length).toBe(32);
    expect(block!.prevBlockHash.length).toBe(32);
    expect(block!.proposalTxsHash.length).toBe(32);
    expect(block!.upgrades).toEqual([]);
  });

  it("serializes the requested height and parses nullable responses", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return null as T;
      },
    };

    const block = await getBlockByNumber(transport, 42n);

    expect(block).toBeNull();
    expect(calls).toEqual([
      { method: "groundhog_getBlockByNumber", params: [42] },
    ]);
  });

  it.each([-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])(
    "rejects a height that JSON cannot serialize safely: %s",
    async (height) => {
      await expect(
        getBlockByNumber(new MockTransport(), height),
      ).rejects.toThrow("height must be a non-negative safe integer");
    },
  );
});

describe("getPendingTransactionCount", () => {
  it("returns the mock pending transaction count as bigint", async () => {
    const transport = new MockTransport();
    await sendTransaction(transport, await makeDummySignedTx());

    const count = await getPendingTransactionCount(transport);

    expect(count).toBe(0n);
  });

  it("parses string counts", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return "9007199254740993" as T;
      },
    };

    await expect(getPendingTransactionCount(transport)).resolves.toBe(
      9007199254740993n,
    );
  });

  it("rejects malformed pending transaction counts", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return null as T;
      },
    };

    await expect(getPendingTransactionCount(transport)).rejects.toThrow(
      /Invalid pending transaction count/,
    );
  });

  it("rejects negative pending transaction counts", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return -1 as T;
      },
    };

    await expect(getPendingTransactionCount(transport)).rejects.toThrow(
      /Invalid pending transaction count/,
    );
  });
});

describe("view", () => {
  it("serializes request fields and parses return output with events", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          output: { result: "return", returnData: "0x0102" },
          events: [
            {
              contractAddress: "0x" + "11".repeat(32),
              topics: ["0x" + "22".repeat(32)],
              data: "0x0304",
            },
          ],
          height: "7",
        } as T;
      },
    };

    const response = await view(transport, {
      contract: contractAddress(new Uint8Array(32).fill(0xab)),
      entrypoint: contractEntrypointID(new Uint8Array(8).fill(0xcd)),
      calldata: calldata(new Uint8Array([0x01, 0x02, 0x03])),
      caller: contractAddress(new Uint8Array(32).fill(0xef)),
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    assert.isDefined(call);
    expect(call.method).toBe("groundhog_view");
    expect(call.params).toEqual([
      {
        contract: "0x" + "ab".repeat(32),
        entrypoint: "0x" + "cd".repeat(8),
        calldata: "0x010203",
        caller: "0x" + "ef".repeat(32),
      },
    ]);
    expect(response.output).toEqual({
      result: "return",
      returnData: new Uint8Array([0x01, 0x02]),
    });
    expect(response.events).toEqual([
      {
        contractAddress: contractAddress(new Uint8Array(32).fill(0x11)),
        topics: [new Uint8Array(32).fill(0x22)],
        data: new Uint8Array([0x03, 0x04]),
      },
    ]);
    expect(response.height).toBe(7n);
  });

  it("omits caller when not provided and parses abort output", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          output: { result: "abort", abortData: "0x0a0b" },
          events: [],
          height: 8,
        } as T;
      },
    };

    const response = await view(transport, {
      contract: contractAddress(new Uint8Array(32).fill(0xab)),
      entrypoint: contractEntrypointID(new Uint8Array(8).fill(0xcd)),
      calldata: calldata(new Uint8Array([0x01, 0x02, 0x03])),
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    assert.isDefined(call);
    expect(call.params).toEqual([
      {
        contract: "0x" + "ab".repeat(32),
        entrypoint: "0x" + "cd".repeat(8),
        calldata: "0x010203",
      },
    ]);
    expect(response.output).toEqual({
      result: "abort",
      abortData: new Uint8Array([0x0a, 0x0b]),
    });
    expect(response.height).toBe(8n);
  });

  it("parses fault output", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          output: { result: "fault" },
          events: [],
          height: 9,
        } as T;
      },
    };

    const response = await view(transport, {
      contract: contractAddress(new Uint8Array(32).fill(0xab)),
      entrypoint: contractEntrypointID(new Uint8Array(8).fill(0xcd)),
      calldata: calldata(new Uint8Array([0x01, 0x02, 0x03])),
    });

    expect(response.output).toEqual({ result: "fault" });
    expect(response.height).toBe(9n);
  });

  it("rejects a response without an events array", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          output: { result: "fault" },
          height: 9,
        } as T;
      },
    };

    await expect(
      view(transport, {
        contract: contractAddress(new Uint8Array(32)),
        entrypoint: contractEntrypointID(new Uint8Array(8)),
        calldata: calldata(new Uint8Array()),
      }),
    ).rejects.toThrow("Expected view response events to be an array");
  });

  it.each([
    {
      field: "contractAddress",
      event: { topics: [], data: "0x" },
    },
    {
      field: "topics",
      event: { contractAddress: "0x" + "11".repeat(32), data: "0x" },
    },
    {
      field: "data",
      event: { contractAddress: "0x" + "11".repeat(32), topics: [] },
    },
  ])("rejects an event missing $field", async ({ field, event }) => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          output: { result: "fault" },
          events: [event],
          height: 9,
        } as T;
      },
    };

    await expect(
      view(transport, {
        contract: contractAddress(new Uint8Array(32)),
        entrypoint: contractEntrypointID(new Uint8Array(8)),
        calldata: calldata(new Uint8Array()),
      }),
    ).rejects.toThrow(field);
  });
});

describe("getTransactionReceipt", () => {
  it("returns receipt for submitted tx", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const txHash = await sendTransaction(transport, signedTx);
    const receipt = await getTransactionReceipt(transport, txHash);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toEqual(txHash);
    expect(receipt!.execResult).toBe(ExecResult.ExecResultOK);
    expect(receipt!.events).toEqual([]);
  });

  it("returns null for unknown tx", async () => {
    const transport = new MockTransport();
    const fakeHash = hashFromHex("0x" + "00".repeat(32));
    const receipt = await getTransactionReceipt(transport, fakeHash);
    expect(receipt).toBeNull();
  });

  it("parses a non-empty event list", async () => {
    const txHash = hashFromHex("0x" + "aa".repeat(32));
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          txHash: "0x" + "aa".repeat(32),
          height: "42",
          status: { result: "ok" },
          gasUsed: 7,
          events: [
            {
              contractAddress: "0x" + "11".repeat(32),
              topics: ["0x" + "22".repeat(32)],
              data: "0x0304",
            },
          ],
        } as T;
      },
    };

    const receipt = await getTransactionReceipt(transport, txHash);

    expect(receipt?.events).toEqual([
      {
        contractAddress: contractAddress(new Uint8Array(32).fill(0x11)),
        topics: [new Uint8Array(32).fill(0x22)],
        data: new Uint8Array([0x03, 0x04]),
      },
    ]);
  });

  it("parses gasUsed as a bigint", async () => {
    const txHash = hashFromHex("0x" + "aa".repeat(32));
    const receiptFor = (gasUsed: unknown) => {
      const transport: Transport = {
        async request<T>(): Promise<T> {
          return {
            txHash: "0x" + "aa".repeat(32),
            height: 42,
            status: { result: "ok" },
            events: [],
            gasUsed,
          } as T;
        },
      };
      return getTransactionReceipt(transport, txHash);
    };

    expect((await receiptFor(4242))?.gasUsed).toBe(4242n);
    expect((await receiptFor(0))?.gasUsed).toBe(0n);
    expect((await receiptFor(Number.MAX_SAFE_INTEGER))?.gasUsed).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect((await receiptFor("18446744073709551615"))?.gasUsed).toBe(
      18446744073709551615n,
    );
  });

  it("rejects a missing or malformed gasUsed", async () => {
    const txHash = hashFromHex("0x" + "aa".repeat(32));
    for (const gasUsed of [
      undefined,
      null,
      -1,
      1.5,
      "abc",
      "-1",
      true,
      {},
      // Rounded by the JSON decoder before reaching the parser.
      Number.MAX_SAFE_INTEGER + 1,
      // One past the u64 maximum.
      "18446744073709551616",
    ]) {
      const transport: Transport = {
        async request<T>(): Promise<T> {
          return {
            txHash: "0x" + "aa".repeat(32),
            height: 42,
            status: { result: "ok" },
            events: [],
            gasUsed,
          } as T;
        },
      };
      await expect(getTransactionReceipt(transport, txHash)).rejects.toThrow(
        InvalidTransactionReceiptError,
      );
    }
  });

  it("rejects an event topic that is not exactly 32 bytes", async () => {
    const txHash = hashFromHex("0x" + "aa".repeat(32));
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          txHash: "0x" + "aa".repeat(32),
          height: 42,
          status: { result: "ok" },
          gasUsed: 7,
          events: [
            {
              contractAddress: "0x" + "11".repeat(32),
              topics: ["0x" + "22".repeat(31)],
              data: "0x",
            },
          ],
        } as T;
      },
    };

    await expect(getTransactionReceipt(transport, txHash)).rejects.toThrow(
      /topic 0.*exactly 32 bytes/,
    );
  });
});

describe("getTransactionStatus", () => {
  it("returns committed for submitted tx", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const txHash = await sendTransaction(transport, signedTx);
    const status = await getTransactionStatus(transport, txHash);
    expect(status.status).toBe("committed");
  });

  it("returns unknown for missing tx", async () => {
    const transport = new MockTransport();
    const fakeHash = hashFromHex("0x" + "00".repeat(32));
    const status = await getTransactionStatus(transport, fakeHash);
    expect(status.status).toBe("unknown");
  });

  it.each(["exclusiveLock", "boundsExceeded", "insufficientFunds"])(
    "parses recent failure diagnostics: %s",
    async (code) => {
      const transport: Transport = {
        async request<T>(): Promise<T> {
          return {
            status: "recentFailure",
            attemptHeight: "42",
            conflict: {
              address: "0x" + "ab".repeat(32),
              key: "0x010203",
              code,
            },
          } as T;
        },
      };

      const status = await getTransactionStatus(
        transport,
        hashFromHex("0x" + "11".repeat(32)),
      );

      expect(status).toEqual({
        status: "recentFailure",
        attemptHeight: 42n,
        conflict: {
          address: contractAddress(new Uint8Array(32).fill(0xab)),
          key: new Uint8Array([1, 2, 3]),
          code,
        },
      });
    },
  );

  it("maps unknown recent failure conflict codes to other", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          status: "recentFailure",
          attemptHeight: 42,
          conflict: {
            address: "0x" + "ab".repeat(32),
            key: "0x",
            code: "newerConflictCode",
          },
        } as T;
      },
    };

    const status = await getTransactionStatus(
      transport,
      hashFromHex("0x" + "11".repeat(32)),
    );

    expect(status).toMatchObject({
      status: "recentFailure",
      conflict: { code: "other" },
    });
  });

  it("returns other for explicit or unknown future statuses", async () => {
    const explicitOther: Transport = {
      async request<T>(): Promise<T> {
        return { status: "other" } as T;
      },
    };
    const futureStatus: Transport = {
      async request<T>(): Promise<T> {
        return { status: "queuedElsewhere" } as T;
      },
    };
    const txHash = hashFromHex("0x" + "11".repeat(32));

    await expect(getTransactionStatus(explicitOther, txHash)).resolves.toEqual({
      status: "other",
    });
    await expect(getTransactionStatus(futureStatus, txHash)).resolves.toEqual({
      status: "other",
    });
  });
});

describe("getTransactionsByAddress", () => {
  it("returns empty transaction ref page from mock", async () => {
    const transport = new MockTransport();
    const page = await getTransactionsByAddress(transport, {
      address: contractAddress(new Uint8Array(32).fill(0x11)),
    });

    expect(page.refs).toEqual([]);
    expect(page.cursor.length).toBe(0);
    expect(page.latestBlock).toBe(0n);
    expect(page.oldestBlock).toBe(0n);
  });

  it("serializes query in the shape the gateway's AddressTransactionQuery schema expects", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          refs: [],
          cursor: "0x",
          latestBlock: 0,
          oldestBlock: 0,
        } as T;
      },
    };
    const address = contractAddress(new Uint8Array(32).fill(0xab));

    await getTransactionsByAddress(transport, {
      address,
      order: "descending",
      anchor: { height: 42n },
      cursor: new Uint8Array([0x01, 0x02, 0x03]),
      limit: 10,
    });

    expect(calls).toEqual([
      {
        method: "groundhog_getTransactionsByAddress",
        params: [
          {
            address: "0x" + "ab".repeat(32),
            order: "descending",
            anchor: { kind: "atHeight", height: 42 },
            cursor: "0x010203",
            limit: 10,
          },
        ],
      },
    ]);
  });

  it("parses transaction refs and page metadata", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          refs: [
            { txHash: "0x" + "cd".repeat(32), height: "9007199254740993" },
          ],
          cursor: "0x0a0b",
          latestBlock: "9007199254740994",
          oldestBlock: 7,
        } as T;
      },
    };

    const page = await getTransactionsByAddress(transport, {
      address: contractAddress(new Uint8Array(32).fill(0xab)),
    });

    expect(page.refs).toEqual([
      {
        txHash: hashFromHex("0x" + "cd".repeat(32)),
        height: 9007199254740993n,
      },
    ]);
    expect(page.cursor).toEqual(new Uint8Array([0x0a, 0x0b]));
    expect(page.latestBlock).toBe(9007199254740994n);
    expect(page.oldestBlock).toBe(7n);
  });
});

describe("getEvents", () => {
  it("returns empty event page from mock", async () => {
    const transport = new MockTransport();
    const page = await getEvents(transport, {
      filters: [
        {
          contractAddresses: [contractAddress(new Uint8Array(32).fill(0x11))],
        },
      ],
    });
    expect(page.events).toEqual([]);
    expect(page.latestBlock).toBe(0n);
    expect(page.oldestBlock).toBe(0n);
    expect(page.cursor.length).toBe(0);
  });

  it("latestBlock reflects chain height", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);

    const page = await getEvents(transport, {
      filters: [
        {
          contractAddresses: [contractAddress(new Uint8Array(32).fill(0x11))],
        },
      ],
    });
    expect(page.latestBlock).toBe(1n);
  });

  it("serializes query in the shape the gateway's EventQuery schema expects", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const spyTransport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          events: [],
          cursor: "0x",
          latestBlock: 0,
          oldestBlock: 0,
        } as T;
      },
    };

    const addr = contractAddress(new Uint8Array(32).fill(0xab));
    const topic = new Uint8Array(32).fill(0xcd);

    await getEvents(spyTransport, {
      filters: [
        {
          contractAddresses: [addr],
          topics: { topic0: [topic] },
        },
      ],
      order: "descending",
      anchor: { height: 42n },
      cursor: new Uint8Array([0x01, 0x02, 0x03]),
      limit: 10,
    });

    expect(calls).toEqual([
      {
        method: "groundhog_getEvents",
        params: [
          {
            filters: [
              {
                contractAddresses: ["0x" + "ab".repeat(32)],
                topics: {
                  topic0: ["0x" + "cd".repeat(32)],
                  topic1: [],
                  topic2: [],
                },
              },
            ],
            cursor: "0x010203",
            order: "descending",
            anchor: { kind: "atHeight", height: 42 },
            limit: 10,
          },
        ],
      },
    ]);
  });

  it("parses a non-empty event page", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          events: [
            {
              txHash: "0x" + "aa".repeat(32),
              blockHeight: "42",
              sequenceNumber: 7,
              event: {
                contractAddress: "0x" + "11".repeat(32),
                topics: ["0x" + "22".repeat(32)],
                data: "0x0304",
              },
            },
          ],
          cursor: "0x05",
          latestBlock: "50",
          oldestBlock: 1,
        } as T;
      },
    };

    const page = await getEvents(transport, { filters: [] });

    expect(page.events).toEqual([
      {
        txHash: hashFromHex("0x" + "aa".repeat(32)),
        blockHeight: 42n,
        sequenceNumber: 7,
        event: {
          contractAddress: contractAddress(new Uint8Array(32).fill(0x11)),
          topics: [new Uint8Array(32).fill(0x22)],
          data: new Uint8Array([0x03, 0x04]),
        },
      },
    ]);
  });

  it("rejects an event with more than three topics", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          events: [
            {
              txHash: "0x" + "aa".repeat(32),
              blockHeight: 42,
              sequenceNumber: 7,
              event: {
                contractAddress: "0x" + "11".repeat(32),
                topics: Array.from({ length: 4 }, () => "0x" + "22".repeat(32)),
                data: "0x",
              },
            },
          ],
          cursor: "0x",
          latestBlock: 42,
          oldestBlock: 1,
        } as T;
      },
    };

    await expect(getEvents(transport, { filters: [] })).rejects.toThrow(
      /at most 3 topics/,
    );
  });

  it("rejects an event whose serialized topics and data exceed 1024 bytes", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          events: [
            {
              txHash: "0x" + "aa".repeat(32),
              blockHeight: 42,
              sequenceNumber: 7,
              event: {
                contractAddress: "0x" + "11".repeat(32),
                topics: Array.from({ length: 3 }, () => "0x" + "22".repeat(32)),
                data: "0x" + "33".repeat(929),
              },
            },
          ],
          cursor: "0x",
          latestBlock: 42,
          oldestBlock: 1,
        } as T;
      },
    };

    await expect(getEvents(transport, { filters: [] })).rejects.toThrow(
      /exceed 1024 bytes/,
    );
  });
});

describe("getStorageAt", () => {
  it("rejects a non-32-byte key before issuing a request", async () => {
    const transport = new MockTransport();
    await expect(
      getStorageAt(
        transport,
        contractAddress(new Uint8Array(32)),
        new Uint8Array(16),
      ),
    ).rejects.toThrow(/32 bytes/);
  });

  it("returns blockHeight and a null item for an unwritten key on the mock", async () => {
    const transport = new MockTransport();
    const read = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(read.blockHeight).toBe(0n);
    expect(read.item).toBeNull();
  });

  it("decodes each StorageItemInfo variant returned by the server", async () => {
    // Hand-rolled transport that returns scripted shapes per call so we
    // can exercise the per-variant demux without committing the mock to
    // a fixed return.
    const responses: unknown[] = [
      { blockHeight: 7, item: { kind: "nonnegativeInt", value: "12345" } },
      {
        blockHeight: 8,
        item: { kind: "bytestring", bytes: "0x0102deadbeef" },
      },
      { blockHeight: 9, item: { kind: "authData" } },
      { blockHeight: 10, item: { kind: "retrocausalQueue" } },
      { blockHeight: 11, item: { kind: "replayCacheEntry" } },
      {
        blockHeight: 12,
        item: {
          kind: "deployedContract",
          hash: "0x" + "ab".repeat(32),
          size: 4096,
          contractType: 1,
        },
      },
      { blockHeight: 13, item: { kind: "unknown", typeId: 99 } },
    ];
    let i = 0;
    const transport: Transport = {
      async request<T>() {
        const r = responses[i++];
        return r as T;
      },
    };

    const r0 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r0.blockHeight).toBe(7n);
    expect(r0.item).toEqual({ kind: "nonnegativeInt", value: 12345n });

    const r1 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r1.item?.kind).toBe("bytestring");
    if (r1.item?.kind === "bytestring") {
      expect(Array.from(r1.item.bytes)).toEqual([
        0x01, 0x02, 0xde, 0xad, 0xbe, 0xef,
      ]);
    }

    const r2 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r2.item).toEqual({ kind: "authData" });

    const r3 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r3.item).toEqual({ kind: "retrocausalQueue" });

    const r4 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r4.item).toEqual({ kind: "replayCacheEntry" });

    const r5 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r5.item?.kind).toBe("deployedContract");
    if (r5.item?.kind === "deployedContract") {
      expect(r5.item.size).toBe(4096);
      expect(r5.item.contractType).toBe(1);
      expect(r5.item.hash.length).toBe(32);
    }

    const r6 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r6.item).toEqual({ kind: "unknown", typeId: 99 });
  });
});
