import {
  ExecResult,
  gasAmount,
  type GasAmount,
  type SHA256Hash,
} from "@groundhogchain/protocol";
import type { CoreGroundhogClient } from "../client.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { WaitForTransactionReceiptOptions } from "../actions/public/waitForTransactionReceipt.js";
import type { ContractCall } from "../contract/method.js";
import { ContractReceiptError } from "../contract/method.js";
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

/** A successful transaction and its original root receipt. */
export interface ExecutionResult {
  txHash: SHA256Hash;
  receipt: TransactionReceipt;
}

/** Submission may have reached the node; recover by observing its known hash without resubmitting. */
export async function submitAndObserve(
  client: Pick<CoreGroundhogClient, "waitForTransactionReceipt">,
  txHash: SHA256Hash,
  submit: () => Promise<unknown>,
  options?: WaitForTransactionReceiptOptions,
): Promise<ExecutionResult> {
  let submissionCause: unknown;
  try {
    await submit();
  } catch (cause) {
    submissionCause = cause;
  }
  try {
    const receipt = await client.waitForTransactionReceipt(txHash, options);
    return { txHash: receipt.txHash, receipt };
  } catch (cause) {
    if (submissionCause !== undefined && cause instanceof Error)
      Object.defineProperty(cause, "submissionCause", {
        value: submissionCause,
      });
    throw cause;
  }
}

/** Wait for commitment and require successful execution. */
export async function waitForExecution(
  client: Pick<CoreGroundhogClient, "waitForTransactionReceipt">,
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

/** Decode DefaultWallet child returns without modifying the root receipt. Works after disconnect. */
export function decodeExecution<T extends readonly ContractCall[]>(
  receipt: TransactionReceipt,
  calls: T,
  adapter: WalletInvocationAdapter = defaultWalletAdapter,
): CallResults<T> {
  if (receipt.execResult !== ExecResult.ExecResultOK) {
    if (calls.length === 1) {
      const outcome = calls[0]!.method.decodeReceiptOutcome(receipt);
      if (outcome.kind !== "return") throw new ContractReceiptError(outcome);
    }
    throw new TransactionExecutionError(receipt);
  }
  const buffers = adapter.decodeExecutionReturns?.(receipt);
  if (buffers == null) throw new ExecutionReturnUnavailableError(receipt);
  if (buffers.length !== calls.length)
    throw new Error(
      `Transaction ${toHex0x(receipt.txHash)} returned ${buffers.length} child results; expected ${calls.length}`,
    );
  return calls.map((call, index) =>
    call.method.decodeReturn(buffers[index]!),
  ) as CallResults<T>;
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

/** Derive a root budget from explicit child budgets and a calibrated wallet overhead. This is not gas estimation. */
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
