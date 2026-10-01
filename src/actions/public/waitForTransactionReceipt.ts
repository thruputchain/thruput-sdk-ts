import {
  sha256Hash,
  type SHA256Hash,
  type NetworkHash,
} from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type {
  TransactionReceipt,
  TransactionStatus,
  TransactionFailureCause,
} from "../../types/rpc.js";
import { GroundhogRpcErrorCode, JsonRpcError } from "../../transport/http.js";
import { classifyReadError } from "../../transport/readError.js";
import { getNetworkInfo } from "./getNetworkInfo.js";
import { assertNetworkMatchesCluster } from "../../cluster.js";
import { toHex0x } from "../hex.js";
import { getTransactionReceipt } from "./getTransactionReceipt.js";
import { getTransactionStatus } from "./getTransactionStatus.js";

const maxTimerDelayMs = 2_147_483_647;

export interface WaitForTransactionReceiptOptions {
  /** Cancel observation, not the submitted transaction. */
  signal?: AbortSignal;
  /** Verify the observation endpoint before every receipt query. */
  expectedNetworkHash?: NetworkHash;
  /** Advisory progress; a status is not an execution receipt. */
  onStatus?: (status: TransactionStatus) => void;
  /** Maximum time to wait, in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Delay between receipt queries, in milliseconds. Defaults to 250 ms. */
  pollingIntervalMs?: number;
}

/** Observation ended without proving whether the transaction committed. */
export class TransactionReceiptTimeoutError extends Error {
  constructor(
    readonly txHash: SHA256Hash,
    readonly lastStatus: TransactionStatus | undefined,
    cause?: unknown,
  ) {
    super(
      `Timed out waiting for transaction receipt ${toHex0x(txHash)}` +
        (lastStatus?.status === "recentFailure"
          ? `. Last advisory failure at height ${lastStatus.attemptHeight}: ${failureMessage(lastStatus.cause)}`
          : "") +
        (cause ? `. Last receipt query failed: ${errorMessage(cause)}` : ""),
      { cause },
    );
    this.name = "TransactionReceiptTimeoutError";
  }
}

/** The node rejected a transaction before commitment. */
export class TransactionRejectedError extends Error {
  constructor(
    readonly txHash: SHA256Hash,
    readonly reason: string,
  ) {
    super(`Transaction ${toHex0x(txHash)} was rejected: ${reason}`);
    this.name = "TransactionRejectedError";
  }
}

/**
 * Wait for a transaction to commit and return its receipt.
 *
 * A committed execution failure is returned as a receipt. Inspect
 * `receipt.execResult` to determine whether execution succeeded.
 * A timeout stops this wait but does not prove the transaction failed.
 */
export async function waitForTransactionReceipt(
  transport: Transport,
  txHash: SHA256Hash,
  options: WaitForTransactionReceiptOptions = {},
): Promise<TransactionReceipt> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollingIntervalMs = options.pollingIntervalMs ?? 250;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > maxTimerDelayMs
  ) {
    throw new RangeError(`timeoutMs must be between 0 and ${maxTimerDelayMs}`);
  }
  if (
    !Number.isFinite(pollingIntervalMs) ||
    pollingIntervalMs < 0 ||
    pollingIntervalMs > maxTimerDelayMs
  ) {
    throw new RangeError(
      `pollingIntervalMs must be between 0 and ${maxTimerDelayMs}`,
    );
  }
  txHash = sha256Hash(new Uint8Array(txHash));
  const expectedNetworkHash = options.expectedNetworkHash?.slice() as
    | NetworkHash
    | undefined;
  const deadline = performance.now() + timeoutMs;
  let lastStatus: TransactionStatus | undefined;
  let lastReceiptFailure: unknown;
  const timeoutError = () =>
    new TransactionReceiptTimeoutError(txHash, lastStatus, lastReceiptFailure);

  async function beforeDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    options.signal?.throwIfAborted();
    if (performance.now() >= deadline) throw timeoutError();
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      const result = await Promise.race([
        new Promise<T>((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(
            () => controller.abort(timeoutError()),
            Math.ceil(Math.max(0, deadline - performance.now())),
          );
        }),
        operation(signal),
      ]);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      controller.abort();
    }
  }

  while (true) {
    let receipt: TransactionReceipt | null = null;
    let networkVerified = expectedNetworkHash === undefined;
    try {
      if (expectedNetworkHash) {
        const network = await beforeDeadline((signal) =>
          getNetworkInfo(transport, { signal }),
        );
        assertNetworkMatchesCluster(
          {
            name: "transaction observation",
            networkHash: expectedNetworkHash,
            capabilities: [],
          },
          network,
        );
        networkVerified = true;
      }
      receipt = await beforeDeadline((signal) =>
        getTransactionReceipt(transport, txHash, { signal }),
      );
      lastReceiptFailure = undefined;
    } catch (cause) {
      options.signal?.throwIfAborted();
      if (!isRetryableReceiptFailure(cause)) throw cause;
      lastReceiptFailure = cause;
    }
    if (receipt) return receipt;

    // Receipts remain authoritative when the advisory status endpoint fails.
    const status = networkVerified
      ? await beforeDeadline((signal) =>
          getTransactionStatus(transport, txHash, { signal }),
        ).catch(() => undefined)
      : undefined;
    options.signal?.throwIfAborted();
    if (status) {
      lastStatus = status;
      options.onStatus?.(status);
    }
    if (status?.status === "invalid") {
      throw new TransactionRejectedError(txHash, status.reason);
    }

    if (performance.now() >= deadline) {
      throw timeoutError();
    }
    const delayMs = Math.max(
      0,
      Math.min(pollingIntervalMs, deadline - performance.now()),
    );
    await beforeDeadline(
      (signal) =>
        new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, Math.ceil(delayMs));
          signal.addEventListener("abort", abort, { once: true });
        }),
    );
  }
}

function isRetryableReceiptFailure(cause: unknown): boolean {
  return (
    (cause instanceof JsonRpcError &&
      cause.code === GroundhogRpcErrorCode.TxNotFound) ||
    classifyReadError(cause) === "transient"
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failureMessage(cause: TransactionFailureCause): string {
  switch (cause.kind) {
    case "dbConflict":
      return `${cause.conflict.code} conflict at ${toHex0x(cause.conflict.address)} key ${toHex0x(cause.conflict.key)}`;
    case "contractRejected":
      return `${cause.code} rejection of new contract at index ${cause.contractIndex}`;
    case "other":
      return "unknown failure cause";
  }
}
