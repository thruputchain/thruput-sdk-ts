import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionReceipt } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";
import { getTransactionReceipt } from "./getTransactionReceipt.js";
import { getTransactionStatus } from "./getTransactionStatus.js";

const maxTimerDelayMs = 2_147_483_647;

export interface WaitForTransactionReceiptOptions {
  /** Maximum time to wait, in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Delay between receipt queries, in milliseconds. Defaults to 250 ms. */
  pollingIntervalMs?: number;
}

/**
 * Wait for a transaction to commit and return its receipt.
 *
 * A committed execution failure is returned as a receipt. Inspect
 * `receipt.execResult` to determine whether execution succeeded.
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
  const deadline = performance.now() + timeoutMs;
  let advisoryFailure: string | undefined;
  const timeoutError = () =>
    new Error(
      `Timed out waiting for transaction receipt ${toHex0x(txHash)}` +
        (advisoryFailure ? `. ${advisoryFailure}` : ""),
    );

  async function beforeDeadline<T>(operation: () => Promise<T>): Promise<T> {
    if (performance.now() >= deadline) throw timeoutError();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(timeoutError()),
            Math.ceil(Math.max(0, deadline - performance.now())),
          );
        }),
        operation(),
      ]);
      if (performance.now() >= deadline) throw timeoutError();
      return result;
    } catch (cause) {
      if (performance.now() >= deadline) throw timeoutError();
      throw cause;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  while (true) {
    const receipt = await beforeDeadline(() =>
      getTransactionReceipt(transport, txHash),
    );
    if (receipt) return receipt;

    // Receipts remain authoritative when the advisory status endpoint fails.
    const status = await beforeDeadline(() =>
      getTransactionStatus(transport, txHash),
    ).catch(() => undefined);
    if (status?.status === "invalid") {
      throw new Error(
        `Transaction ${toHex0x(txHash)} was rejected: ${status.reason}`,
      );
    }
    if (status?.status === "recentFailure") {
      advisoryFailure =
        `Last advisory failure at height ${status.attemptHeight}: ` +
        `${status.conflict.code} conflict at ${toHex0x(status.conflict.address)} ` +
        `key ${toHex0x(status.conflict.key)}`;
    }

    if (performance.now() >= deadline) {
      throw timeoutError();
    }
    const delayMs = Math.max(
      0,
      Math.min(pollingIntervalMs, deadline - performance.now()),
    );
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(delayMs)));
  }
}
