import {
  ExecResult,
  gasAmount,
  type GasAmount,
  type SHA256Hash,
} from "@thruputchain/protocol";
import type { CoreThruputClient } from "../client.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { WaitForTransactionReceiptOptions } from "../actions/public/waitForTransactionReceipt.js";
import type { ContractCall } from "../contract/method.js";
import {
  defaultWalletAdapter,
  type WalletInvocationAdapter,
} from "./invocationAdapter.js";
import { toHex0x } from "../actions/hex.js";

/** A committed execution failure, retaining the original receipt. */
export class TransactionExecutionError extends Error {
  constructor(readonly receipt: TransactionReceipt) {
    super(
      `Transaction ${toHex0x(receipt.txHash)} failed with ${ExecResult[receipt.execResult] ?? receipt.execResult}`,
    );
    this.name = "TransactionExecutionError";
  }
}

/** Require successful execution without interpreting the root's return bytes. */
export function assertTransactionSuccess(receipt: TransactionReceipt): void {
  if (receipt.execResult !== ExecResult.ExecResultOK)
    throw new TransactionExecutionError(receipt);
}

/** A committed transaction and its original root receipt. */
export interface ExecutionResult {
  txHash: SHA256Hash;
  receipt: TransactionReceipt;
}

/** Observation failed after submission was attempted; retain the hash for public recovery. */
export class TransactionObservationError extends Error {
  constructor(
    readonly txHash: SHA256Hash,
    cause: unknown,
    readonly submissionCause?: unknown,
  ) {
    super(
      `Could not observe transaction ${toHex0x(txHash)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "TransactionObservationError";
  }
}

/**
 * Submission may have reached the node; recover by observing its known hash without resubmitting.
 * When supplied, `wasDispatched` must track the actual handoff to the submitter.
 * A failure before that handoff is propagated immediately. Without this signal,
 * submission failures are conservatively treated as potentially broadcast.
 */
export async function submitAndObserve(
  client: Pick<CoreThruputClient, "waitForTransactionReceipt">,
  txHash: SHA256Hash,
  submit: () => Promise<unknown>,
  options?: WaitForTransactionReceiptOptions,
  wasDispatched?: () => boolean,
): Promise<ExecutionResult> {
  let submissionCause: unknown;
  try {
    await submit();
  } catch (cause) {
    if (wasDispatched?.() === false) throw cause;
    submissionCause = cause;
  }
  try {
    const receipt = await client.waitForTransactionReceipt(txHash, options);
    return { txHash: receipt.txHash, receipt };
  } catch (cause) {
    throw new TransactionObservationError(txHash, cause, submissionCause);
  }
}

/** Wait for commitment and require successful execution. */
export async function waitForExecution(
  client: Pick<CoreThruputClient, "waitForTransactionReceipt">,
  hash: SHA256Hash,
  options?: WaitForTransactionReceiptOptions,
): Promise<ExecutionResult> {
  const receipt = await client.waitForTransactionReceipt(hash, options);
  assertTransactionSuccess(receipt);
  return { txHash: receipt.txHash, receipt };
}

/** Ordered result types for a tuple of calls. */
export type CallResults<T extends readonly ContractCall[]> = {
  [K in keyof T]: T[K] extends ContractCall<infer R> ? R : never;
};

/**
 * Decode DefaultWallet child returns without modifying the root receipt.
 * Works after disconnect and preserves call order. Supply an adapter for other
 * wallets. Wallets such as DevWallet that discard child return data report
 * unavailable results. Failed wallet receipts are not decoded with a child ABI:
 * even a single child call does not establish where an abort originated.
 */
export function decodeExecution<T extends readonly ContractCall[]>(
  receipt: TransactionReceipt,
  calls: T,
  adapter: WalletInvocationAdapter = defaultWalletAdapter,
): CallResults<T> {
  // Even one child call can fail in the wallet root; its abort bytes are not a child receipt.
  assertTransactionSuccess(receipt);
  try {
    const buffers = adapter.decodeExecutionReturns?.(receipt);
    if (buffers == null) throw new ExecutionReturnUnavailableError(receipt);
    if (buffers.length !== calls.length)
      throw new Error(
        `Returned ${buffers.length} child results; expected ${calls.length}`,
      );
    return calls.map((call, index) =>
      call.method.decodeReturn(buffers[index]!),
    ) as CallResults<T>;
  } catch (cause) {
    if (cause instanceof ExecutionReturnUnavailableError) throw cause;
    throw new ExecutionDecodeError(receipt, cause);
  }
}

/** A committed successful execution whose return data could not be decoded. */
export class ExecutionDecodeError extends Error {
  constructor(
    readonly receipt: TransactionReceipt,
    cause: unknown,
  ) {
    super(
      `Transaction ${toHex0x(receipt.txHash)} committed, but result decoding failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "ExecutionDecodeError";
  }
}

/** Execution succeeded, but this wallet does not preserve child return buffers. */
export class ExecutionReturnUnavailableError extends Error {
  constructor(readonly receipt: TransactionReceipt) {
    super(
      `Transaction ${toHex0x(receipt.txHash)} committed successfully, but its wallet does not expose child return data`,
    );
    this.name = "ExecutionReturnUnavailableError";
  }
}

/**
 * Sum explicit child budgets and a calibrated wallet overhead, checking u64 bounds.
 * This is not gas estimation. Calibrate budgets against the target runtime and
 * workload; there is no universally safe wallet overhead. Root gas reserves
 * scheduling capacity against the sender's free HOG. Storage deposits are a
 * separate requirement, and funding a target contract does not sponsor root gas.
 */
export function walletGasLimit(
  calls: readonly { gas_limit: GasAmount }[],
  overhead: GasAmount,
): GasAmount {
  const limits = [overhead, ...calls.map((call) => call.gas_limit)];
  if (limits.some((limit) => typeof limit !== "bigint" || limit < 0n))
    throw new RangeError("Gas budgets must be nonnegative bigint values");
  const total = limits.reduce((sum, limit) => sum + limit, 0n);
  if (total > 0xffff_ffff_ffff_ffffn)
    throw new RangeError("Root gas budget exceeds u64");
  return gasAmount(total);
}
