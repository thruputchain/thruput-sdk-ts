import { toBase58 } from "../../encoding.js";
import { describe, expect, it, vi } from "vitest";
import { contractAddress } from "@thruputchain/protocol";
import { createThruputClient } from "../../client.js";
import { HttpTransport, JsonRpcError } from "../../transport/http.js";
import type { Transport } from "../../transport/types.js";
import type { EventQuery } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";
import { iterateEventPages } from "./iterateEventPages.js";

const address = contractAddress(new Uint8Array(32).fill(1));
const query: EventQuery = {
  filters: [{ contractAddresses: [address] }],
  order: "descending",
  anchor: { height: 50n },
  limit: 20,
};
const rawPage = (cursor: string) => ({
  events: [],
  cursor,
  latestBlock: "50",
  oldestBlock: "5",
});

function transportFor(
  request: (...args: Parameters<Transport["request"]>) => Promise<unknown>,
): Transport {
  return {
    request: <T>(...args: Parameters<Transport["request"]>) =>
      request(...args) as Promise<T>,
  };
}

describe("iterateEventPages", () => {
  it("requests exactly one page per next, including empty continuation pages", async () => {
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValueOnce(rawPage("0x01"))
      .mockResolvedValueOnce(rawPage("0x"));
    const client = await createThruputClient({
      transport: transportFor(request),
    });
    const pages = client.iterateEventPages(query);
    expect(request).not.toHaveBeenCalled();
    expect(await pages.next()).toEqual({
      done: false,
      value: {
        events: [],
        cursor: new Uint8Array([1]),
        latestBlock: 50n,
        oldestBlock: 5n,
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await pages.next()).done).toBe(false);
    expect((await pages.next()).done).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [index, [, params]] of request.mock.calls.entries()) {
      expect(params).toEqual([
        {
          filters: [
            {
              contractAddresses: [toBase58(address)],
              topics: { topic0: [], topic1: [], topic2: [] },
            },
          ],
          order: "descending",
          anchor: { kind: "atHeight", height: "50" },
          limit: 20,
          cursor: index === 0 ? "0x" : "0x01",
        },
      ]);
    }
  });

  it("yields a populated terminal page before stopping", async () => {
    const request = vi.fn<Transport["request"]>().mockResolvedValue({
      ...rawPage("0x"),
      events: [
        {
          txHash: toBase58(address),
          blockHeight: "42",
          sequenceNumber: 0,
          event: { contractAddress: toBase58(address), topics: [], data: "0x" },
        },
      ],
    });
    const pages = iterateEventPages(transportFor(request), query);
    expect((await pages.next()).value?.events).toHaveLength(1);
    expect((await pages.next()).done).toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not fetch ahead when the consumer breaks", async () => {
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValue(rawPage("0x01"));
    for await (const page of iterateEventPages(transportFor(request), query)) {
      expect(page.cursor).toEqual(new Uint8Array([1]));
      break;
    }
    expect(request).toHaveBeenCalledOnce();
  });

  it("snapshots inputs at creation and protects continuation from page mutation", async () => {
    const input = structuredClone({ ...query, cursor: new Uint8Array([9]) });
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValueOnce(rawPage("0x01"))
      .mockResolvedValueOnce(rawPage("0x"));
    const pages = iterateEventPages(transportFor(request), input);
    input.filters[0]!.contractAddresses[0]!.fill(8);
    input.cursor.fill(8);
    input.order = "ascending";
    const first = await pages.next();
    first.value!.cursor.fill(8);
    await pages.next();
    expect((request.mock.calls[0]![1] as unknown[])[0]).toMatchObject({
      cursor: "0x09",
      order: "descending",
      filters: [{ contractAddresses: [toBase58(address)] }],
    });
    expect((request.mock.calls[1]![1] as unknown[])[0]).toMatchObject({
      cursor: "0x01",
      order: "descending",
    });
  });

  it.each([
    ["0x01", "0x01"],
    ["0x01", "0x02", "0x01"],
  ])("rejects cursor cycles: %j", async (...cursors) => {
    const request = vi.fn<Transport["request"]>();
    for (const cursor of cursors)
      request.mockResolvedValueOnce(rawPage(cursor));
    const pages = iterateEventPages(transportFor(request), query);
    for (let index = 0; index < cursors.length - 1; index++) await pages.next();
    await expect(pages.next()).rejects.toThrow("repeated pagination cursor");
    expect(request).toHaveBeenCalledTimes(cursors.length);
  });

  it("includes the supplied resume cursor in cycle detection", async () => {
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValue(rawPage("0x01"));
    const pages = iterateEventPages(transportFor(request), {
      ...query,
      cursor: new Uint8Array([1]),
    });
    await expect(pages.next()).rejects.toThrow("repeated pagination cursor");
    expect(request).toHaveBeenCalledOnce();
  });

  it("propagates RPC errors without retrying or restarting the scan", async () => {
    const error = new JsonRpcError(-32602, "cursor rejected");
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValueOnce(rawPage("0x01"))
      .mockRejectedValueOnce(error);
    const pages = iterateEventPages(transportFor(request), query);
    await pages.next();
    await expect(pages.next()).rejects.toBe(error);
    expect((await pages.next()).done).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("honors cancellation before the first request and between pages", async () => {
    const reason = new Error("stopped");
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValue(rawPage("0x01"));
    await expect(
      iterateEventPages(transportFor(request), query, {
        signal: AbortSignal.abort(reason),
      }).next(),
    ).rejects.toBe(reason);
    expect(request).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pages = iterateEventPages(transportFor(request), query, {
      signal: controller.signal,
    });
    await pages.next();
    controller.abort(reason);
    await expect(pages.next()).rejects.toBe(reason);
    expect(request).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight HTTP page request", async () => {
    const controller = new AbortController();
    const transport = new HttpTransport("https://rpc.example", {
      fetch: async (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    });
    const pending = iterateEventPages(transport, query, {
      signal: controller.signal,
    }).next();
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
