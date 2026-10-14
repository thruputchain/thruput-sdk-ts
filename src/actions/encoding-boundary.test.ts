import { describe, expect, it, vi } from "vitest";
import { contractAddress, sha256Hash } from "@thruputchain/protocol";
import { toBase58 } from "../encoding.js";
import { getBalance } from "./public/getBalance.js";
import { getTransactionReceipt } from "./public/getTransactionReceipt.js";
import { getEvents } from "./public/getEvents.js";
import { toHex0x } from "./hex.js";
import type { Transport } from "../transport/types.js";

const bytes = new Uint8Array(32).fill(0x11);
const address = contractAddress(bytes);
const hash = sha256Hash(bytes);

describe("RPC semantic encoding boundary", () => {
  it("rejects legacy hex addresses rather than detecting their format", async () => {
    for (const encoded of [toHex0x(bytes), toHex0x(bytes).slice(2)]) {
      const transport: Transport = {
        async request<T>() {
          return { address: encoded, rawBalance: "0", height: "1" } as T;
        },
      };
      await expect(getBalance(transport, address)).rejects.toThrow();
    }
  });

  it("preserves hex topics, event bytes, and opaque cursors alongside base58 identities", async () => {
    const event = {
      contractAddress: toBase58(address),
      topics: [toHex0x(bytes)],
      data: toHex0x(bytes),
    };
    const request = vi.fn(async (_method: string, _params?: unknown[]) => ({
      events: [
        { txHash: toBase58(hash), blockHeight: "1", sequenceNumber: 0, event },
      ],
      cursor: "0x0102",
      latestBlock: "1",
      oldestBlock: "1",
    }));
    const transport: Transport = {
      request: async <T>(method: string, params?: unknown[]) =>
        request(method, params) as Promise<T>,
    };
    const page = await getEvents(transport, {
      filters: [{ contractAddresses: [address], topics: { topic0: [bytes] } }],
      cursor: new Uint8Array([1, 2]),
    });
    expect(request.mock.calls[0]?.[1]).toMatchObject([
      {
        filters: [
          {
            contractAddresses: [toBase58(address)],
            topics: { topic0: [toHex0x(bytes)] },
          },
        ],
        cursor: "0x0102",
      },
    ]);
    expect(page.events[0]?.event).toMatchObject({
      contractAddress: address,
      topics: [bytes],
      data: bytes,
    });
    expect(page.cursor).toEqual(new Uint8Array([1, 2]));
  });

  it("keeps receipt return bytes hex and rejects hex transaction identifiers", async () => {
    const response = {
      txHash: toBase58(hash),
      height: "1",
      gasUsed: "0",
      status: { result: "ok" },
      events: [],
      returnData: toHex0x(bytes),
    };
    const transport: Transport = {
      async request<T>() {
        return response as T;
      },
    };
    expect((await getTransactionReceipt(transport, hash))?.returnData).toEqual(
      bytes,
    );
    response.txHash = toHex0x(hash);
    await expect(getTransactionReceipt(transport, hash)).rejects.toThrow(
      "hash does not match",
    );
  });
});
