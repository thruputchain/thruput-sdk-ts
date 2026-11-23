import { isUnsupportedRpcValue } from "../rpc/unsupported.js";
import { isThruputError, ThruputError } from "../errors/thruputError.js";
import {
  receiptFacts,
  transactionResultUndecodable,
} from "../errors/transaction.js";
import { contractDecodeFailed } from "../contract/errors.js";
import { gasAmount, type GasAmount } from "@thruputchain/protocol";
import type { CoreThruputClient } from "../client.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { WaitForTransactionReceiptOptions } from "../actions/public/waitForTransactionReceipt.js";
import type { ContractCall } from "../contract/method.js";
import {
  defaultWalletAdapter,
  type WalletInvocationAdapter,
} from "./invocationAdapter.js";
import { beforeDeadline, validateTimer } from "../actions/deadline.js";
import { toBase58 } from "../encoding.js";
import type { RpcSendTransactionResult } from "../rpc/generated.js";
import {
  createSubmissionEvidence,
  type SubmissionEvidence,
} from "../transaction/submissionEvidence.js";
import {
  isCancellation,
  isLocalRequestError,
  isNodeRejection,
  reasonAfterDispatch,
  reasonBeforeDispatch,
  timeoutError,
  transactionNotSubmitted,
  transactionOutcomeUnknown,
  withSubmission,
} from "./transactionErrors.js";

/**
 * Require successful execution. A failed execution throws code
 * `transactionFailed`; an unsupported execution value throws code
 * `transactionOutcomeUnsupported`, never inferred to be success or failure.
 * Both keep the complete receipt in `transaction.receipt`.
 */
export function assertTransactionSuccess(
  receipt: TransactionReceipt,
  submission?: SubmissionEvidence,
): asserts receipt is TransactionReceipt & {
  execution: { result: "return"; returnData: Uint8Array };
} {
  const hash = toBase58(receipt.transactionHash);
  const facts = receiptFacts(receipt, "outcomeUnsupported", submission);
  if (facts.outcome === "succeeded") return;
  const { execution } = receipt;
  if (facts.outcome === "failed" && !isUnsupportedRpcValue(execution))
    throw new ThruputError(
      "transactionFailed",
      `Transaction ${hash} execution failed (${execution.result})`,
      { transaction: facts },
    );
  throw new ThruputError(
    "transactionOutcomeUnsupported",
    `Transaction ${hash} has an unsupported execution outcome`,
    { transaction: facts },
  );
}

/**
 * Keep low-level future values intact, but never project them into an admitted
 * hash. An admission value other than `accepted` throws code
 * `transactionAdmissionUnsupported` with outcome `unknown`.
 */
export function assertTransactionAdmission(
  response: RpcSendTransactionResult,
  submission?: SubmissionEvidence,
): void {
  if (response.admission !== "accepted")
    throw new ThruputError(
      "transactionAdmissionUnsupported",
      "Transaction submission returned an unsupported admission outcome",
      {
        context: { response },
        transaction: {
          hash: submission?.transactionHash ?? response.transactionHash,
          outcome: "unknown",
          reason: "admissionUnsupported",
          ...(submission ? { submission } : {}),
        },
      },
    );
}
export {
  createSubmissionEvidence,
  type SubmissionEvidence,
} from "../transaction/submissionEvidence.js";
export interface ExecutionResult {
  transactionHash: Uint8Array;
  receipt: TransactionReceipt;
  submission?: SubmissionEvidence;
}
/**
 * Submit once, then reconcile only by reads. No path replaces or repeats signed
 * bytes. Every failure has `transaction` facts with the signed bytes:
 * `transactionNotSubmitted` before dispatch, otherwise
 * `transactionOutcomeUnknown`.
 */
export async function submitAndObserve(
  client: Pick<CoreThruputClient, "waitForTransactionReceipt">,
  evidence: SubmissionEvidence,
  submit: (signal: AbortSignal) => Promise<void>,
  options?: WaitForTransactionReceiptOptions,
  wasDispatched?: () => boolean,
): Promise<ExecutionResult> {
  const submission = createSubmissionEvidence(
    evidence.signedTransaction,
    evidence.networkHash,
  );
  const timeoutMs = options?.timeoutMs ?? 30000;
  validateTimer(timeoutMs, "timeoutMs");
  const deadline = performance.now() + timeoutMs;
  const signal = options?.signal;
  if (signal?.aborted)
    throw transactionNotSubmitted(submission, "cancelled", signal.reason);
  if (timeoutMs === 0)
    throw transactionNotSubmitted(
      submission,
      "timeout",
      timeoutError("Transaction submission timed out before dispatch"),
    );
  let submissionError: unknown;
  try {
    await beforeDeadline(submit, deadline, signal, () =>
      timeoutError("Transaction submission timed out"),
    );
  } catch (cause) {
    if (wasDispatched?.() === false || isLocalRequestError(cause, signal))
      throw transactionNotSubmitted(
        submission,
        reasonBeforeDispatch(cause, signal),
        cause,
      );
    if (!isCancellation(cause, signal) && isNodeRejection(cause))
      throw transactionOutcomeUnknown(submission, "nodeRejected", cause);
    if (signal?.aborted || performance.now() >= deadline)
      throw transactionOutcomeUnknown(
        submission,
        reasonAfterDispatch(cause, signal),
        cause,
      );
    // The node may have the transaction. Observe it; never submit again.
    submissionError = cause;
  }
  try {
    const receipt = await client.waitForTransactionReceipt(
      submission.transactionHash,
      {
        ...options,
        expectedNetworkHash: submission.networkHash,
        timeoutMs: Math.max(0, deadline - performance.now()),
      },
    );
    return { transactionHash: receipt.transactionHash, receipt, submission };
  } catch (cause) {
    throw withSubmission(cause, submission, submissionError);
  }
}
/**
 * Check execution wait options before preparing or signing, so an invalid
 * option never leaves a signed or sent transaction. `knownCommitment` applies
 * only to observing an existing hash, so execution rejects it.
 */
export function validateExecutionWait(
  wait: WaitForTransactionReceiptOptions | undefined,
): void {
  validateTimer(wait?.timeoutMs ?? 30000, "timeoutMs");
  validateTimer(wait?.pollingIntervalMs ?? 250, "pollingIntervalMs");
  if (wait?.knownCommitment !== undefined)
    throw new TypeError(
      "knownCommitment applies only when observing an existing transaction",
    );
}

/** Wait for a committed receipt, then require execution success. */
export async function waitForExecution(
  client: Pick<CoreThruputClient, "waitForTransactionReceipt">,
  hash: Uint8Array,
  options?: WaitForTransactionReceiptOptions,
): Promise<ExecutionResult> {
  const receipt = await client.waitForTransactionReceipt(hash, options);
  assertTransactionSuccess(receipt);
  return { transactionHash: receipt.transactionHash, receipt };
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
  submission?: SubmissionEvidence,
): CallResults<T> {
  // Even one child call can fail in the wallet root; its abort bytes are not a child receipt.
  assertTransactionSuccess(receipt, submission);
  try {
    const buffers = adapter.decodeExecutionReturns?.(receipt);
    if (buffers == null) throw resultUnavailable(receipt, submission);
    if (buffers.length !== calls.length)
      throw contractDecodeFailed(
        `Returned ${buffers.length} child results; expected ${calls.length}`,
      );
    return calls.map((call, index) =>
      call.method.decodeReturn(buffers[index]!),
    ) as CallResults<T>;
  } catch (cause) {
    if (isThruputError(cause, "transactionResultUnavailable")) throw cause;
    throw transactionResultUndecodable(receipt, cause, submission);
  }
}

/** Execution succeeded, but this wallet does not preserve child return buffers. */
function resultUnavailable(
  receipt: TransactionReceipt,
  submission?: SubmissionEvidence,
): ThruputError<"transactionResultUnavailable"> {
  return new ThruputError(
    "transactionResultUnavailable",
    `Transaction ${toBase58(receipt.transactionHash)} committed successfully, but its wallet does not expose child return data`,
    { transaction: receiptFacts(receipt, "resultUnavailable", submission) },
  );
}

/**
 * Sum explicit child budgets and a calibrated wallet overhead, checking u64 bounds.
 * This is not gas estimation. Calibrate budgets against the target runtime and
 * workload; there is no universally safe wallet overhead. Root gas reserves
 * scheduling capacity against the sender's free native-token balance. Storage
 * deposits are a separate requirement, and funding a target contract does not
 * sponsor root gas.
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
