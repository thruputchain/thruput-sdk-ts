import { ExecResult } from "@groundhogchain/protocol";
import { describe, expect, it } from "vitest";
import type { Transport } from "../../transport/types.js";
import { hashFromHex } from "../hex.js";
import { waitForTransactionReceipt } from "./waitForTransactionReceipt.js";

const txHash = hashFromHex("0x" + "11".repeat(32));
const rawReceipt = {
  txHash: "0x" + "11".repeat(32),
  height: "42",
  status: { result: "ok" },
  events: [],
  returnData: null,
  abortData: null,
};

describe("waitForTransactionReceipt", () => {
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

  it("continues polling after an advisory recent failure", async () => {
    let receiptQueries = 0;
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        if (method === "groundhog_getTransactionReceipt") {
          receiptQueries += 1;
          return (receiptQueries === 1 ? null : rawReceipt) as T;
        }
        return {
          status: "recentFailure",
          attemptHeight: "41",
          conflict: {
            address: "0x" + "22".repeat(32),
            key: "0x0102",
            code: "exclusiveLock",
          },
        } as T;
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
      waitForTransactionReceipt(transport, txHash, { timeoutMs: 0 }),
    ).rejects.toThrow(`Transaction 0x${"11".repeat(32)} was rejected: expired`);
  });

  it("includes the last advisory failure when polling times out", async () => {
    const transport: Transport = {
      async request<T>(method: string): Promise<T> {
        return (
          method === "groundhog_getTransactionReceipt"
            ? null
            : {
                status: "recentFailure",
                attemptHeight: 41,
                conflict: {
                  address: "0x" + "22".repeat(32),
                  key: "0x0102",
                  code: "exclusiveLock",
                },
              }
        ) as T;
      },
    };

    await expect(
      waitForTransactionReceipt(transport, txHash, { timeoutMs: 0 }),
    ).rejects.toThrow(
      "Last advisory failure at height 41: exclusiveLock conflict",
    );
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

  it("does not start another query after the deadline", async () => {
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

    await expect(
      waitForTransactionReceipt(transport, txHash, {
        timeoutMs: 5,
        pollingIntervalMs: 100,
      }),
    ).rejects.toThrow(`Timed out waiting for transaction receipt`);
    expect(receiptQueries).toBe(1);
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
