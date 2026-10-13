import { ExecResult, networkHash } from "@thruputchain/protocol";
import { describe, expect, it, vi } from "vitest";
import type { Transport } from "../../transport/types.js";
import {
  ThruputRpcErrorCode,
  HttpRequestError,
  HttpResponseError,
  JsonRpcError,
} from "../../transport/http.js";
import { hashFromHex } from "../hex.js";
import {
  TransactionReceiptTimeoutError,
  TransactionProcessingError,
  waitForTransactionReceipt,
} from "./waitForTransactionReceipt.js";

const txHash = hashFromHex("0x" + "11".repeat(32));
const rawReceipt = {
  txHash: "0x" + "11".repeat(32),
  height: "42",
  status: { result: "ok" },
  events: [],
  returnData: null,
  abortData: null,
  gasUsed: "1234",
};

describe("waitForTransactionReceipt", () => {
  it.each(["retry", "dropped"] as const)(
    "stops on %s with typed evidence and never submits",
    async (status) => {
      const methods: string[] = [];
      const error = { source: "executor", code: -7 };
      const onStatus = vi.fn();
      const transport: Transport = {
        async request<T>(method: string) {
          methods.push(method);
          if (method === "groundhog_getTransactionReceipt") return null as T;
          return { status, error } as T;
        },
      };
      const failure = await waitForTransactionReceipt(transport, txHash, {
        onStatus,
      }).catch((cause) => cause);
      expect(failure).toBeInstanceOf(TransactionProcessingError);
      expect(failure).toMatchObject({ txHash, status, error });
      expect(onStatus).toHaveBeenCalledWith({ status, error });
      expect(methods).toEqual([
        "groundhog_getTransactionReceipt",
        "groundhog_getTransactionStatus",
      ]);
    },
  );

  it("waits for a receipt after commitment without an indexed height", async () => {
    let receiptQueries = 0;
    const onStatus = vi.fn();
    const transport: Transport = {
      async request<T>(method: string) {
        if (method === "groundhog_getTransactionReceipt")
          return (++receiptQueries === 1 ? null : rawReceipt) as T;
        return { status: "committed" } as T;
      },
    };
    await expect(
      waitForTransactionReceipt(transport, txHash, {
        onStatus,
        pollingIntervalMs: 0,
      }),
    ).resolves.toMatchObject({ height: 42n });
    expect(onStatus).toHaveBeenCalledWith({ status: "committed" });
  });

  it("retries transient identity checks before reading transaction evidence", async () => {
    let attempts = 0;
    const methods: string[] = [];
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        methods.push(method);
        if (method === "groundhog_networkInfo") {
          if (++attempts === 1)
            throw new HttpRequestError(
              "https://rpc.example",
              method,
              new TypeError("fetch failed"),
            );
          return { networkHash: rawReceipt.txHash } as T;
        }
        return rawReceipt as T;
      },
    };
    await expect(
      waitForTransactionReceipt(transport, txHash, {
        expectedNetworkHash: networkHash(txHash),
        pollingIntervalMs: 0,
      }),
    ).resolves.toMatchObject({ height: 42n });
    expect(methods).toEqual([
      "groundhog_networkInfo",
      "groundhog_networkInfo",
      "groundhog_getTransactionReceipt",
    ]);
  });
  it("cancels an in-flight query without retrying", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const request = vi.fn((_method, _params, options) => {
      received = options.signal;
      return new Promise<never>(() => {});
    });
    const pending = waitForTransactionReceipt({ request }, txHash, {
      signal: controller.signal,
    });
    const failure = new Error("cancel observation");
    controller.abort(failure);
    await expect(pending).rejects.toBe(failure);
    expect(received?.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a receipt for a different hash", async () => {
    const request = vi.fn(async () => ({
      ...rawReceipt,
      txHash: "0x" + "22".repeat(32),
    }));
    await expect(
      waitForTransactionReceipt(
        { request: request as Transport["request"] },
        txHash,
      ),
    ).rejects.toThrow(/does not match/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("returns a committed receipt", async () => {
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        expect(method).toBe("groundhog_getTransactionReceipt");
        return rawReceipt as T;
      },
    };

    const receipt = await waitForTransactionReceipt(transport, txHash);

    expect(receipt.txHash).toEqual(txHash);
    expect(receipt.height).toBe(42n);
    expect(receipt.execResult).toBe(ExecResult.ExecResultOK);
    expect(receipt.gasUsed).toBe(1234n);
  });

  it("returns committed execution failures for the caller to inspect", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        return {
          ...rawReceipt,
          status: { result: "reverted" },
          abortData: "0x0102",
        } as T;
      },
    };

    const receipt = await waitForTransactionReceipt(transport, txHash);

    expect(receipt.execResult).toBe(ExecResult.ExecResultTxRootFrameReverted);
    expect(receipt.abortData).toEqual(new Uint8Array([1, 2]));
  });

  it.each([
    {
      kind: "dbConflict",
      conflict: {
        address: "0x" + "22".repeat(32),
        key: "0x0102",
        code: "exclusiveLock",
      },
    },
    { kind: "contractRejected", contractIndex: 0, code: "duplicate" },
    { kind: "other" },
  ])(
    "continues polling after advisory $kind and reports progress",
    async (cause) => {
      let receiptQueries = 0;
      const statuses: unknown[] = [];
      const transport: Transport = {
        async request<T>(method: string): Promise<T> {
          if (method === "groundhog_getTransactionReceipt") {
            receiptQueries += 1;
            return (receiptQueries === 1 ? null : rawReceipt) as T;
          }
          return { status: "recentFailure", attemptHeight: "41", cause } as T;
        },
      };
      await expect(
        waitForTransactionReceipt(transport, txHash, {
          timeoutMs: 100,
          pollingIntervalMs: 0,
          onStatus: (status) => statuses.push(status),
        }),
      ).resolves.toMatchObject({ height: 42n });
      expect(receiptQueries).toBe(2);
      expect(statuses).toEqual([
        expect.objectContaining({
          status: "recentFailure",
          attemptHeight: 41n,
          cause: expect.objectContaining({ kind: cause.kind }),
        }),
      ]);
    },
  );

  it("continues polling when the advisory status query fails", async () => {
    let receiptQueries = 0;
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        if (method === "groundhog_getTransactionReceipt") {
          receiptQueries += 1;
          return (receiptQueries === 1 ? null : rawReceipt) as T;
        }
        throw new Error("status unavailable");
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, {
        timeoutMs: 100,
        pollingIntervalMs: 0,
      }),
    ).resolves.toMatchObject({ height: 42n });
    expect(receiptQueries).toBe(2);
  });

  it.each([
    ThruputRpcErrorCode.TxNotFound,
    ThruputRpcErrorCode.BackendUnavailable,
    ThruputRpcErrorCode.BackendTimeout,
    ThruputRpcErrorCode.Overloaded,
  ])("retries transient receipt error %i", async (code) => {
    let receiptQueries = 0;
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        if (method === "groundhog_getTransactionReceipt") {
          receiptQueries += 1;
          if (receiptQueries === 1) {
            throw new JsonRpcError(code, "try again");
          }
          return rawReceipt as T;
        }
        return { status: "pending" } as T;
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, {
        timeoutMs: 100,
        pollingIntervalMs: 0,
      }),
    ).resolves.toMatchObject({ height: 42n });
    expect(receiptQueries).toBe(2);
  });

  it.each([
    [
      "fetch failure",
      new HttpRequestError(
        "https://rpc.example",
        "groundhog_getTransactionReceipt",
        new TypeError("fetch failed"),
      ),
    ],
    ["HTTP 500", new HttpResponseError(500, "server failure")],
    ["HTTP 429", new HttpResponseError(429, "rate limited")],
    ["request timeout", new DOMException("request timed out", "TimeoutError")],
  ])("retries a transient %s", async (_, failure) => {
    let receiptQueries = 0;
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        if (method === "groundhog_getTransactionReceipt") {
          receiptQueries += 1;
          if (receiptQueries === 1) throw failure;
          return rawReceipt as T;
        }
        return { status: "pending" } as T;
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, {
        timeoutMs: 100,
        pollingIntervalMs: 0,
      }),
    ).resolves.toMatchObject({ height: 42n });
    expect(receiptQueries).toBe(2);
  });

  it("does not retry deterministic receipt errors", async () => {
    const failure = new JsonRpcError(
      ThruputRpcErrorCode.InvalidParams,
      "invalid hash",
    );
    const transport: Transport = {
      async request<T>(): Promise<T> {
        throw failure;
      },
    };

    await expect(waitForTransactionReceipt(transport, txHash)).rejects.toBe(
      failure,
    );
  });

  it.each([
    { ...rawReceipt, height: undefined },
    { ...rawReceipt, height: true },
    { ...rawReceipt, height: "" },
    { ...rawReceipt, status: {} },
  ])("does not retry malformed receipt responses", async (malformed) => {
    let receiptQueries = 0;
    const transport: Transport = {
      async request<T>(): Promise<T> {
        receiptQueries += 1;
        return malformed as T;
      },
    };

    await expect(waitForTransactionReceipt(transport, txHash)).rejects.toThrow(
      "Invalid transaction receipt response",
    );
    expect(receiptQueries).toBe(1);
  });

  it("rejects a terminal invalid transaction", async () => {
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        return (
          method === "groundhog_getTransactionReceipt"
            ? null
            : { status: "invalid", reason: "expired" }
        ) as T;
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, { timeoutMs: 100 }),
    ).rejects.toThrow(`Transaction 0x${"11".repeat(32)} was rejected: expired`);
  });

  it.each([
    [
      {
        kind: "dbConflict",
        conflict: {
          address: "0x" + "22".repeat(32),
          key: "0x0102",
          code: "exclusiveLock",
        },
      },
      "exclusiveLock conflict",
    ],
    [
      { kind: "contractRejected", contractIndex: 2, code: "malformedArtifact" },
      "malformedArtifact rejection of new contract at index 2",
    ],
    [{ kind: "other" }, "unknown failure cause"],
  ])(
    "includes advisory failure %j when polling times out",
    async (cause, message) => {
      const transport: Transport = {
        async request<T>(method: string): Promise<T> {
          return (
            method === "groundhog_getTransactionReceipt"
              ? null
              : {
                  status: "recentFailure",
                  attemptHeight: "41",
                  cause,
                }
          ) as T;
        },
      };
      const error = await waitForTransactionReceipt(transport, txHash, {
        timeoutMs: 50,
        pollingIntervalMs: 100,
      }).catch((error) => error);
      expect(error).toBeInstanceOf(TransactionReceiptTimeoutError);
      expect(error.message).toContain(
        `Last advisory failure at height 41: ${message}`,
      );
      expect(error.lastStatus).toMatchObject({
        status: "recentFailure",
        cause: { kind: cause.kind },
      });
    },
  );

  it("does not query the transport when the timeout is zero", async () => {
    let queries = 0;
    const transport: Transport = {
      async request<T>(): Promise<T> {
        queries += 1;
        return rawReceipt as T;
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, { timeoutMs: 0 }),
    ).rejects.toThrow(`Timed out waiting for transaction receipt`);
    expect(queries).toBe(0);
  });

  it("times out while a transport request is still pending", async () => {
    const transport: Transport = {
      request<T>(): Promise<T> {
        return new Promise(() => {});
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, { timeoutMs: 1 }),
    ).rejects.toThrow(`Timed out waiting for transaction receipt`);
  });

  it("returns a receipt that wins the timeout race", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        return rawReceipt as T;
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, { timeoutMs: 1 }),
    ).resolves.toMatchObject({ height: 42n });
  });

  it("does not start another query after the deadline", async () => {
    vi.useFakeTimers();
    let receiptQueries = 0;
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        if (method === "groundhog_getTransactionReceipt") {
          receiptQueries += 1;
          return null as T;
        }
        return { status: "pending" } as T;
      },
    };

    try {
      const assertion = expect(
        waitForTransactionReceipt(transport, txHash, {
          timeoutMs: 5,
          pollingIntervalMs: 100,
        }),
      ).rejects.toThrow(`Timed out waiting for transaction receipt`);
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
      expect(receiptQueries).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates polling options", async () => {
    const transport: Transport = {
      async request<T>(): Promise<T> {
        throw new Error("should not query transport");
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, { timeoutMs: Number.NaN }),
    ).rejects.toThrow("timeoutMs must be between 0 and 2147483647");
    await expect(
      waitForTransactionReceipt(transport, txHash, {
        pollingIntervalMs: -1,
      }),
    ).rejects.toThrow("pollingIntervalMs must be between 0 and 2147483647");
  });
});
