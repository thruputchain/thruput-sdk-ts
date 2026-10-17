import { describe, expect, it, vi } from "vitest";
import { createThruputClient } from "../../client.js";
import type { Transport } from "../../transport/types.js";
import { getTransactionsByBlock } from "./getTransactionsByBlock.js";
import { getBlockByNumber } from "./getBlockByNumber.js";
import { MockTransport } from "../../transport/mock.js";
import { toBase58 } from "../../encoding.js";

const height = 9223372036854775807n;
const hash = (byte: string) =>
  toBase58(new Uint8Array(32).fill(Number.parseInt(byte, 16)));
const page = () => ({
  refs: [
    { txHash: hash("7f"), height: height.toString() },
    { txHash: hash("80"), height: height.toString() },
  ],
  cursor: "0x00ff80",
  oldestBlock: "1",
  latestBlock: height.toString(),
});
function fixture(value: unknown) {
  const request = vi.fn(async () => value);
  return { request, transport: { request } as Transport };
}

describe("getTransactionsByBlock", () => {
  it("rejects legacy hex transaction identifiers", async () => {
    const raw = page();
    raw.refs[0]!.txHash = `0x${"7f".repeat(32)}`;
    const { transport } = fixture(raw);
    await expect(
      getTransactionsByBlock(transport, { height }),
    ).rejects.toThrow();
  });

  it("forwards cancellation during an in-flight request", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled by caller");
    const transport: Transport = {
      request: (_method, _params, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    };
    const pending = getTransactionsByBlock(
      transport,
      { height },
      { signal: controller.signal },
    );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
  it("binds the client action, preserves wide heights, and sends defaults", async () => {
    const { transport, request } = fixture(page());
    const client = await createThruputClient({ transport });
    const result = await client.getTransactionsByBlock({ height });
    expect(request).toHaveBeenCalledWith(
      "groundhog_getTransactionsByBlock",
      [
        {
          height: height.toString(),
          order: "ascending",
          cursor: "0x",
          limit: 50,
        },
      ],
      undefined,
    );
    expect(result.refs.map((ref) => ref.height)).toEqual([height, height]);
    expect(result.cursor).toEqual(new Uint8Array([0, 255, 128]));
    expect(result.latestBlock).toBe(height);
  });

  it("preserves opaque continuations and allows their retained order", async () => {
    const raw = page();
    raw.cursor = "0x";
    const { transport, request } = fixture(raw);
    const signal = new AbortController().signal;
    const result = await getTransactionsByBlock(
      transport,
      {
        height,
        order: "descending",
        cursor: new Uint8Array([0, 255]),
        limit: 2,
      },
      { signal },
    );
    expect(request).toHaveBeenCalledWith(
      "groundhog_getTransactionsByBlock",
      [
        {
          height: height.toString(),
          order: "descending",
          cursor: "0x00ff",
          limit: 2,
        },
      ],
      { signal },
    );
    expect(result.cursor).toHaveLength(0);
  });

  it.each([0, -1, 201, 1.5, NaN, Infinity])(
    "rejects limit %s before dispatch",
    async (limit) => {
      const { transport, request } = fixture(page());
      await expect(
        getTransactionsByBlock(transport, { height, limit }),
      ).rejects.toThrow("limit");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([-1n, 1n << 63n])(
    "rejects invalid height %s before dispatch",
    async (height) => {
      const { transport, request } = fixture(page());
      await expect(
        getTransactionsByBlock(transport, { height }),
      ).rejects.toThrow("height");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("propagates backend errors and pre-aborted cancellation", async () => {
    const failure = new Error("backend unavailable");
    const request = vi.fn().mockRejectedValue(failure);
    const transport = { request } as Transport;
    await expect(getTransactionsByBlock(transport, { height })).rejects.toBe(
      failure,
    );
    request.mockClear();
    const controller = new AbortController();
    controller.abort(failure);
    await expect(
      getTransactionsByBlock(
        transport,
        { height },
        { signal: controller.signal },
      ),
    ).rejects.toBe(failure);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([0n, 3n, height])(
    "accepts terminal empty pages without claiming block existence at %s",
    async (height) => {
      const { transport } = fixture({
        refs: [],
        cursor: "0x",
        oldestBlock: "1",
        latestBlock: "3",
      });
      expect(
        (await getTransactionsByBlock(transport, { height })).refs,
      ).toEqual([]);
    },
  );

  it.each([
    { ...page(), oldestBlock: "0" },
    { ...page(), latestBlock: "0" },
    { ...page(), latestBlock: 42 },
    { ...page(), cursor: "not-hex" },
    { ...page(), refs: [] },
    { ...page(), refs: [...page().refs].reverse() },
    { ...page(), refs: [page().refs[0], page().refs[0]] },
    { ...page(), refs: [{ txHash: hash("01"), height: "2" }] },
    { ...page(), refs: [{ txHash: "0x01", height: height.toString() }] },
  ])("rejects malformed or inconsistent pages %#", async (raw) => {
    await expect(
      getTransactionsByBlock(fixture(raw).transport, { height }),
    ).rejects.toThrow();
  });

  it("rejects oversized pages and repeated continuations", async () => {
    const { transport } = fixture(page());
    await expect(
      getTransactionsByBlock(transport, { height, limit: 1 }),
    ).rejects.toThrow();
    await expect(
      getTransactionsByBlock(transport, {
        height,
        cursor: new Uint8Array([0, 255, 128]),
      }),
    ).rejects.toThrow("continuation");
  });

  it("accepts descending unsigned hash order", async () => {
    const raw = page();
    raw.refs.reverse();
    const result = await getTransactionsByBlock(fixture(raw).transport, {
      height,
      order: "descending",
    });
    expect(result.refs[0]?.txHash[0]).toBe(128);
  });
});

it("rejects block metadata returned for a different height", async () => {
  const mock = new MockTransport();
  const raw = await mock.request("groundhog_getBlockByNumber", ["0"]);
  await expect(getBlockByNumber(fixture(raw).transport, 1n)).rejects.toThrow(
    "height does not match",
  );
});
