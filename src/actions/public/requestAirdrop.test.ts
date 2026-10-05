import { contractAddress } from "@groundhogchain/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "../../transport/types.js";
import {
  GroundhogRpcErrorCode,
  HttpResponseError,
  HttpRequestError,
  HttpTransport,
  JsonRpcError,
} from "../../transport/http.js";
import { hashFromHex } from "../hex.js";
import {
  InvalidAirdropResponseError,
  requestAirdrop,
  requestAirdropAttempt,
} from "./requestAirdrop.js";

const recipient = contractAddress(new Uint8Array(32).fill(0x11));
const clientNonce = new Uint8Array(16).fill(0x22);
const pending = {
  attemptStatus: "pending",
  recipient: "0x" + "11".repeat(32),
  rawAmount: "100000000",
  txHash: "0x" + "33".repeat(32),
  retryAfterSeconds: "0",
};
const succeeded = {
  attemptStatus: "succeeded",
  recipient: "0x" + "11".repeat(32),
  rawAmount: "100000000",
  txHash: "0x" + "33".repeat(32),
  height: "42",
  status: { result: "ok" },
};

afterEach(() => vi.useRealTimers());

describe("requestAirdropAttempt", () => {
  it("serializes one attempt and decodes a pending response", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return { ...pending, futureField: true } as T;
      },
    };

    const response = await requestAirdropAttempt(transport, {
      recipient,
      clientNonce,
    });

    expect(calls).toEqual([
      {
        method: "groundhog_requestAirdrop",
        params: [
          {
            recipient: "0x" + "11".repeat(32),
            clientNonce: "0x" + "22".repeat(16),
          },
        ],
      },
    ]);
    expect(response).toEqual({
      attemptStatus: "pending",
      recipient,
      rawAmount: 100000000n,
      txHash: hashFromHex("0x" + "33".repeat(32)),
      retryAfterSeconds: 0n,
    });
  });

  it("decodes a succeeded response", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return succeeded as T;
      },
    };

    await expect(
      requestAirdropAttempt(transport, { recipient, clientNonce }),
    ).resolves.toEqual({
      attemptStatus: "succeeded",
      recipient,
      rawAmount: 100000000n,
      txHash: hashFromHex("0x" + "33".repeat(32)),
      height: 42n,
      status: { result: "ok" },
    });
  });

  it("maps future execution statuses to the forward-compatible fallback", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          ...succeeded,
          status: { result: "futureResult", futureField: true },
        } as T;
      },
    };

    await expect(
      requestAirdropAttempt(transport, { recipient, clientNonce }),
    ).resolves.toMatchObject({
      attemptStatus: "succeeded",
      txHash: hashFromHex("0x" + "33".repeat(32)),
      height: 42n,
      rawAmount: 100000000n,
      status: { result: "other" },
    });
  });

  it.each([
    null,
    {},
    { ...pending, attemptStatus: "unknown" },
    { ...pending, recipient: "0x" + "44".repeat(32) },
    { ...pending, recipient: "0x" + "AA".repeat(32) },
    { ...pending, rawAmount: "-1" },
    { ...pending, retryAfterSeconds: -1 },
    { ...pending, retryAfterSeconds: Number.MAX_SAFE_INTEGER + 1 },
    { ...succeeded, txHash: null },
    { ...succeeded, height: -1 },
    { ...succeeded, height: "0x10" },
    { ...succeeded, height: " " },
    { ...succeeded, height: Number.MAX_SAFE_INTEGER + 1 },
    { ...succeeded, status: {} },
  ])("rejects a malformed response: %j", async (result) => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return result as T;
      },
    };

    await expect(
      requestAirdropAttempt(transport, { recipient, clientNonce }),
    ).rejects.toBeInstanceOf(InvalidAirdropResponseError);
  });

  it.each([new Uint8Array(), new Uint8Array(33)])(
    "rejects an invalid nonce length",
    async (invalidNonce) => {
      await expect(
        requestAirdropAttempt(
          { request: vi.fn() },
          {
            recipient,
            clientNonce: invalidNonce,
          },
        ),
      ).rejects.toThrow("clientNonce must contain between 1 and 32 bytes");
    },
  );
});

describe("requestAirdrop", () => {
  it("polls with one explicit nonce until the attempt succeeds", async () => {
    const requests: unknown[][] = [];
    const transport: Transport = {
      async request<T>(_method: string, params?: unknown[]): Promise<T> {
        requests.push(params ?? []);
        return (requests.length === 1 ? pending : succeeded) as T;
      },
    };

    const result = await requestAirdrop(transport, {
      recipient,
      clientNonce,
      timeoutMs: 100,
    });

    expect(result.attemptStatus).toBe("succeeded");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
  });

  it("generates one 16-byte nonce for the logical attempt", async () => {
    const requests: unknown[][] = [];
    const transport: Transport = {
      async request<T>(_method: string, params?: unknown[]): Promise<T> {
        requests.push(params ?? []);
        return (requests.length === 1 ? pending : succeeded) as T;
      },
    };

    await requestAirdrop(transport, { recipient, timeoutMs: 100 });

    const first = requests[0]![0] as { clientNonce: string };
    const second = requests[1]![0] as { clientNonce: string };
    expect(first.clientNonce).toMatch(/^0x[0-9a-f]{32}$/);
    expect(second.clientNonce).toBe(first.clientNonce);
  });

  it("snapshots mutable request inputs before polling", async () => {
    const mutableRecipient = contractAddress(new Uint8Array(32).fill(0x11));
    const mutableNonce = new Uint8Array(16).fill(0x22);
    const requests: unknown[][] = [];
    const transport: Transport = {
      async request<T>(_method: string, params?: unknown[]): Promise<T> {
        requests.push(params ?? []);
        if (requests.length === 1) {
          mutableRecipient.fill(0x44);
          mutableNonce.fill(0x55);
          return pending as T;
        }
        return succeeded as T;
      },
    };

    await requestAirdrop(transport, {
      recipient: mutableRecipient,
      clientNonce: mutableNonce,
      timeoutMs: 100,
    });

    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toEqual([
      {
        recipient: "0x" + "11".repeat(32),
        clientNonce: "0x" + "22".repeat(16),
      },
    ]);
  });

  it.each([
    GroundhogRpcErrorCode.BackendUnavailable,
    GroundhogRpcErrorCode.BackendTimeout,
    GroundhogRpcErrorCode.Overloaded,
  ])("retries transient JSON-RPC error %i", async (code) => {
    vi.useFakeTimers();
    let calls = 0;
    const transport: Transport = {
      async request<T>(): Promise<T> {
        calls += 1;
        if (calls === 1) throw new JsonRpcError(code, "retry");
        return succeeded as T;
      },
    };

    const result = requestAirdrop(transport, {
      recipient,
      clientNonce,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toMatchObject({ attemptStatus: "succeeded" });
    expect(calls).toBe(2);
  });

  it("retries an ambiguous transport failure with the same nonce", async () => {
    vi.useFakeTimers();
    const nonces: string[] = [];
    const transport: Transport = {
      async request<T>(_method: string, params?: unknown[]): Promise<T> {
        nonces.push((params?.[0] as { clientNonce: string }).clientNonce);
        if (nonces.length === 1)
          throw new HttpRequestError(
            "https://rpc.example",
            "groundhog_requestAirdrop",
            new TypeError("fetch failed"),
          );
        return succeeded as T;
      },
    };

    const result = requestAirdrop(transport, {
      recipient,
      clientNonce,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toMatchObject({ attemptStatus: "succeeded" });
    expect(nonces).toEqual(["0x" + "22".repeat(16), "0x" + "22".repeat(16)]);
  });

  it("does not retry a permanent JSON-RPC error", async () => {
    const failure = new JsonRpcError(
      GroundhogRpcErrorCode.InvalidParams,
      "invalid nonce",
    );
    const request = vi.fn(async () => {
      throw failure;
    });

    await expect(
      requestAirdrop({ request }, { recipient, clientNonce }),
    ).rejects.toBe(failure);
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not retry or obscure a malformed JSON-RPC envelope", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1 }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const transport = new HttpTransport("http://localhost", {
      fetch: fetchMock,
    });

    await expect(
      requestAirdrop(transport, { recipient, clientNonce, timeoutMs: 1_000 }),
    ).rejects.toThrow("Invalid JSON-RPC response");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 501, 505, 511])(
    "does not retry permanent HTTP status %i",
    async (status) => {
      const failure = new HttpResponseError(status, "permanent");
      const request = vi.fn(async () => {
        throw failure;
      });

      await expect(
        requestAirdrop({ request }, { recipient, clientNonce }),
      ).rejects.toBe(failure);
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it.each([408, 429, 500, 502, 503, 504])(
    "retries ambiguous HTTP status %i",
    async (status) => {
      vi.useFakeTimers();
      let calls = 0;
      const transport: Transport = {
        async request<T>(): Promise<T> {
          calls += 1;
          if (calls === 1) throw new HttpResponseError(status, "retry");
          return succeeded as T;
        },
      };

      const result = requestAirdrop(transport, {
        recipient,
        clientNonce,
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(250);

      await expect(result).resolves.toMatchObject({
        attemptStatus: "succeeded",
      });
      expect(calls).toBe(2);
    },
  );

  it("times out while a request remains pending", async () => {
    let transportAborted = false;
    const transport: Transport = {
      request<T>(
        _method: string,
        _params?: unknown[],
        options?: { signal?: AbortSignal },
      ): Promise<T> {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            transportAborted = true;
            reject(options.signal?.reason);
          });
        });
      },
    };

    await expect(
      requestAirdrop(transport, { recipient, clientNonce, timeoutMs: 1 }),
    ).rejects.toThrow("Timed out waiting for airdrop");
    expect(transportAborted).toBe(true);
  });

  it("does not query when timeout is zero", async () => {
    const request = vi.fn();

    await expect(
      requestAirdrop({ request }, { recipient, clientNonce, timeoutMs: 0 }),
    ).rejects.toThrow("Timed out waiting for airdrop");
    expect(request).not.toHaveBeenCalled();
  });

  it("aborts while a request remains pending", async () => {
    const abort = new AbortController();
    const transport: Transport = {
      request<T>(): Promise<T> {
        return new Promise(() => {});
      },
    };
    const result = requestAirdrop(transport, {
      recipient,
      clientNonce,
      signal: abort.signal,
    });

    abort.abort(new Error("cancelled"));

    await expect(result).rejects.toThrow("cancelled");
  });

  it("aborts while waiting for the next pending poll", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return { ...pending, retryAfterSeconds: "5" } as T;
      },
    };
    const result = requestAirdrop(transport, {
      recipient,
      clientNonce,
      signal: abort.signal,
    });
    await vi.advanceTimersByTimeAsync(0);

    abort.abort(new Error("cancelled while pending"));

    await expect(result).rejects.toThrow("cancelled while pending");
  });

  it("validates timeoutMs before querying", async () => {
    const request = vi.fn();

    await expect(
      requestAirdrop(
        { request },
        { recipient, clientNonce, timeoutMs: Number.NaN },
      ),
    ).rejects.toThrow("timeoutMs must be between 0 and 2147483647");
    expect(request).not.toHaveBeenCalled();
  });
});
