import { afterEach, describe, expect, it, vi } from "vitest";
import { createThruputClient } from "../client.js";
import { HttpRequestError, HttpResponseError, HttpTransport } from "./http.js";
import { classifyReadError } from "./readError.js";

interface Request {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown[];
}

function requests(init?: RequestInit): Request[] {
  return JSON.parse(String(init?.body)) as Request[];
}

function respond(items: Request[]) {
  return Response.json(
    items.map(({ id, method }) => ({ jsonrpc: "2.0", id, result: method })),
  );
}

describe("HTTP batching", () => {
  afterEach(() => vi.useRealTimers());

  it("is disabled by default and with batch: false", async () => {
    for (const batch of [undefined, false]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
        const body = JSON.parse(String(init?.body)) as Request;
        expect(Array.isArray(body)).toBe(false);
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: body.method,
        });
      });
      const transport = new HttpTransport("https://rpc.example", {
        fetch,
        batch,
      });
      await expect(
        Promise.all([transport.request("a"), transport.request("b")]),
      ).resolves.toEqual(["a", "b"]);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("batches typed client calls and matches reversed responses by ID", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
      const items = requests(init);
      expect(items.map(({ method, params }) => [method, params])).toEqual([
        ["groundhog_chainTip", []],
        ["groundhog_version", []],
      ]);
      return Response.json(
        items.reverse().map(({ id, method }) => ({
          jsonrpc: "2.0",
          id,
          result:
            method === "groundhog_chainTip"
              ? { height: "7", blockHash: `0x${"00".repeat(32)}` }
              : {
                  wireFormat: "6.0.0",
                  implementation: "test",
                  commitHash: null,
                },
        })),
      );
    });
    const client = await createThruputClient({
      transport: new HttpTransport("https://rpc.example", {
        batch: true,
        fetch,
      }),
    });
    const [tip, version] = await Promise.all([
      client.getChainTip(),
      client.getVersion(),
    ]);
    expect(tip.height).toBe(7n);
    expect(version.implementation).toBe("test");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("splits full batches immediately and sends the remaining single call as an array", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      respond(requests(init)),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: { maxSize: 2, waitMs: 20 },
      fetch,
    });
    const result = Promise.all(
      [0, 1, 2, 3, 4].map((i) => transport.request(String(i))),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(19);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(["0", "1", "2", "3", "4"]);
    expect(fetch.mock.calls.map(([, init]) => requests(init).length)).toEqual([
      2, 2, 1,
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the default limit of 100 and preserves headers and serialized params", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      respond(requests(init)),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      headers: { Authorization: "test" },
      fetch,
    });
    const params = ["before"];
    const first = transport.request("first", params);
    params[0] = "after";
    await Promise.all([
      first,
      ...Array.from({ length: 100 }, () => transport.request("next")),
    ]);
    expect(fetch.mock.calls.map(([, init]) => requests(init).length)).toEqual([
      100, 1,
    ]);
    expect(requests(fetch.mock.calls[0]?.[1])[0]?.params).toEqual(["before"]);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "test",
    });
  });

  it("isolates RPC errors and does not retry submissions", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      Response.json(
        requests(init).map(({ id, method }) => ({
          jsonrpc: "2.0",
          id,
          ...(method === "groundhog_sendRawTransaction"
            ? { error: { code: -32001, message: "rejected", data: "detail" } }
            : { result: null }),
        })),
      ),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      fetch,
    });
    const result = await Promise.allSettled([
      transport.request("groundhog_sendRawTransaction", ["0x01"]),
      transport.request("read"),
    ]);
    expect(result[0]).toMatchObject({
      status: "rejected",
      reason: {
        name: "JsonRpcError",
        method: "groundhog_sendRawTransaction",
        code: -32001,
        data: "detail",
      },
    });
    expect(result[1]).toEqual({ status: "fulfilled", value: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "missing",
      (items: Request[]) =>
        items.slice(1).map(({ id }) => ({ jsonrpc: "2.0", id, result: 1 })),
    ],
    [
      "duplicate",
      (items: Request[]) =>
        items.map(() => ({ jsonrpc: "2.0", id: items[0]?.id, result: 1 })),
    ],
    [
      "unexpected",
      (items: Request[]) =>
        items.map(({ id }) => ({ jsonrpc: "2.0", id: id + 100, result: 1 })),
    ],
    [
      "string ID",
      (items: Request[]) =>
        items.map(({ id }) => ({ jsonrpc: "2.0", id: String(id), result: 1 })),
    ],
    [
      "wrong version",
      (items: Request[]) =>
        items.map(({ id }) => ({ jsonrpc: "1.0", id, result: 1 })),
    ],
    [
      "both result and error",
      (items: Request[]) =>
        items.map(({ id }) => ({ jsonrpc: "2.0", id, result: 1, error: {} })),
    ],
    [
      "neither result nor error",
      (items: Request[]) => items.map(({ id }) => ({ jsonrpc: "2.0", id })),
    ],
    [
      "non-array",
      () => ({
        jsonrpc: "2.0",
        id: null,
        result: "not an array",
      }),
    ],
  ])("rejects a malformed batch: %s", async (_, response) => {
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      fetch: async (_, init) => Response.json(response(requests(init))),
    });
    const results = await Promise.allSettled([
      transport.request("a"),
      transport.request("b"),
    ]);
    for (const result of results)
      expect(result).toMatchObject({
        status: "rejected",
        reason: {
          message: expect.stringContaining("Invalid JSON-RPC batch response"),
        },
      });
  });

  it("rejects malformed RPC errors without rejecting valid peers", async () => {
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      fetch: async (_, init) =>
        Response.json(
          requests(init).map(({ id }, i) => ({
            jsonrpc: "2.0",
            id,
            ...(i ? { result: 1 } : { error: { code: "bad", message: 1 } }),
          })),
        ),
    });
    const results = await Promise.allSettled([
      transport.request("a"),
      transport.request("b"),
    ]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { message: "Invalid JSON-RPC error response" },
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: 1 });
  });

  it("preserves a whole-batch RPC error for every caller without retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32053, message: "overloaded" },
      }),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      fetch,
    });
    const results = await Promise.allSettled([
      transport.request("a"),
      transport.request("b"),
    ]);
    for (const [index, result] of results.entries()) {
      expect(result).toMatchObject({
        status: "rejected",
        reason: {
          name: "JsonRpcError",
          code: -32053,
          method: index === 0 ? "a" : "b",
        },
      });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends queued peers after a cancellation and removes listeners on success", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      respond(requests(init)),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      timeoutMs: 100,
      fetch,
    });
    const a = new AbortController();
    const b = new AbortController();
    const remove = vi.spyOn(b.signal, "removeEventListener");
    const pending = Promise.allSettled([
      transport.request("a", [], { signal: a.signal }),
      transport.request("b", [], { signal: b.signal }),
    ]);
    a.abort("cancelled");
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toEqual([
      { status: "rejected", reason: "cancelled" },
      { status: "fulfilled", value: "b" },
    ]);
    expect(
      requests(fetch.mock.calls[0]?.[1]).map(({ method }) => method),
    ).toEqual(["b"]);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    b.abort();
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it("lets a later batch finish while an earlier batch is pending", async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
      const items = requests(init);
      return items[0]?.method === "slow" ? response : respond(items);
    });
    const transport = new HttpTransport("https://rpc.example", {
      batch: { maxSize: 1 },
      fetch,
    });
    const slow = transport.request("slow");
    await expect(transport.request("fast")).resolves.toBe("fast");
    release(respond(requests(fetch.mock.calls[0]?.[1])));
    await expect(slow).resolves.toBe("slow");
  });

  it("rejects unserializable params without poisoning the queue", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      respond(requests(init)),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      fetch,
    });
    const results = await Promise.allSettled([
      transport.request("bad", [1n]),
      transport.request("good"),
    ]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: expect.any(TypeError),
    });
    expect(results[1]).toEqual({ status: "fulfilled", value: "good" });
    expect(requests(fetch.mock.calls[0]?.[1])).toHaveLength(1);
  });

  it("removes cancelled queued calls and clears an empty queue's timer", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      respond(requests(init)),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: true,
      fetch,
    });
    const controller = new AbortController();
    const reason = new Error("closed");
    const pending = transport.request("cancel", [], {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      transport.request("already cancelled", [], { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
    const next = transport.request("next");
    await vi.runAllTimersAsync();
    await expect(next).resolves.toBe("next");
  });

  it("cancels one dispatched call promptly while allowing its peer to finish", async () => {
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | null | undefined;
    let items: Request[] = [];
    const transport = new HttpTransport("https://rpc.example", {
      batch: { maxSize: 2 },
      fetch: async (_, init) => {
        signal = init?.signal;
        items = requests(init);
        return response;
      },
    });
    const controller = new AbortController();
    const cancelled = transport.request("a", [], { signal: controller.signal });
    const peer = transport.request("b");
    const reason = new Error("closed");
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(signal?.aborted).toBe(false);
    release(respond(items));
    await expect(peer).resolves.toBe("b");
  });

  it("aborts shared work only after every dispatched caller cancels and removes listeners", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const transport = new HttpTransport("https://rpc.example", {
      batch: { maxSize: 2 },
      timeoutMs: 100,
      fetch: async (_, init) => {
        signal = init?.signal;
        return new Promise((_, reject) =>
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          }),
        );
      },
    });
    const a = new AbortController();
    const b = new AbortController();
    const remove = vi.spyOn(a.signal, "removeEventListener");
    const pending = Promise.allSettled([
      transport.request("a", [], { signal: a.signal }),
      transport.request("b", [], { signal: b.signal }),
    ]);
    a.abort("first");
    expect(signal?.aborted).toBe(false);
    b.abort("second");
    expect(signal?.aborted).toBe(true);
    expect(await pending).toEqual([
      { status: "rejected", reason: "first" },
      { status: "rejected", reason: "second" },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps independent transport queues separate", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
      respond(requests(init)),
    );
    const a = new HttpTransport("https://rpc.example", { batch: true, fetch });
    const b = new HttpTransport("https://rpc.example", { batch: true, fetch });
    await Promise.all([a.request("a"), b.request("b")]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "body", "http", "json"])(
    "preserves %s failure types and per-call methods",
    async (kind) => {
      vi.useFakeTimers();
      const cause = new TypeError("disconnected");
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        if (kind === "network") throw cause;
        if (kind === "http") return new Response(null, { status: 503 });
        if (kind === "json") return new Response("{");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(cause);
            },
          }),
        );
      });
      const transport = new HttpTransport(
        "https://rpc.example/private?secret=1",
        { batch: true, timeoutMs: 100, fetch },
      );
      const pending = Promise.allSettled([
        transport.request("a"),
        transport.request("b"),
      ]);
      await vi.advanceTimersByTimeAsync(0);
      const results = await pending;
      for (const [index, result] of results.entries()) {
        expect(result.status).toBe("rejected");
        if (result.status !== "rejected") continue;
        expect(result.reason).toBeInstanceOf(
          kind === "http"
            ? HttpResponseError
            : kind === "json"
              ? SyntaxError
              : HttpRequestError,
        );
        if (kind !== "json") {
          expect(result.reason).toMatchObject({
            method: index === 0 ? "a" : "b",
            endpoint: "https://rpc.example",
          });
          expect(classifyReadError(result.reason)).toBe("transient");
        }
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("starts the timeout at dispatch and keeps it active through body reading", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            },
          }),
        ),
    );
    const transport = new HttpTransport("https://rpc.example", {
      batch: { waitMs: 50 },
      timeoutMs: 10,
      fetch,
    });
    const pending = Promise.allSettled([
      transport.request("a"),
      transport.request("b"),
    ]);
    await vi.advanceTimersByTimeAsync(49);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(11);
    for (const result of await pending)
      expect(result).toMatchObject({
        status: "rejected",
        reason: { name: "TimeoutError" },
      });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 1.5, 1001, NaN, Infinity])(
    "rejects invalid maxSize %s",
    (maxSize) => {
      expect(
        () => new HttpTransport("https://rpc.example", { batch: { maxSize } }),
      ).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, 2_147_483_648, NaN, Infinity])(
    "rejects invalid waitMs %s",
    (waitMs) => {
      expect(
        () => new HttpTransport("https://rpc.example", { batch: { waitMs } }),
      ).toThrow(RangeError);
    },
  );
});
