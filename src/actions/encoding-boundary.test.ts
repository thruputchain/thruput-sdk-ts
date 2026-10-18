import { describe, expect, it, vi } from "vitest";
import { contractAddress, sha256Hash } from "@thruputchain/protocol";
import { toBase58 } from "../encoding.js";
import { getTransactionReceipt } from "./public/getTransactionReceipt.js";
import { getEvents } from "./public/getEvents.js";
import { toHex0x } from "./hex.js";
import type { Transport } from "../transport/types.js";

const bytes = new Uint8Array(32).fill(0x11);
const address = contractAddress(bytes);
const hash = sha256Hash(bytes);

describe("RPC semantic encoding boundary", () => {
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

  it("decodes base58 receipt hashes and hex return bytes", async () => {
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
    const receipt = await getTransactionReceipt(transport, hash);
    expect(receipt?.txHash).toEqual(hash);
    expect(receipt?.returnData).toEqual(bytes);
  });
});
