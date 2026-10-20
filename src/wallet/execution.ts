import { codec, deserialize } from "@thruputchain/protocol";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { RpcCompatibilityError } from "../rpc/client.js";
import {
  RpcRequestValidationError,
  UnsupportedRpcValue,
} from "../rpc/codec.js";
import { NativeRpcError } from "../rpc/errorReader.js";
import {
  TransactionReceiptObservationError,
  type KnownCommitment,
} from "../actions/public/waitForTransactionReceipt.js";
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

/** A committed execution failure, retaining the complete native receipt. */
export class TransactionExecutionError extends Error {
  constructor(
    readonly receipt: TransactionReceipt,
    readonly submission?: SubmissionEvidence,
  ) {
    super(
      receipt.execution instanceof UnsupportedRpcValue
        ? `Transaction ${toBase58(receipt.transactionHash)} has an unsupported execution outcome`
        : `Transaction ${toBase58(receipt.transactionHash)} execution failed (${receipt.execution.result})`,
    );
    this.name = "TransactionExecutionError";
  }
}
/** A future execution variant is unsupported, never inferred to be success or failure. */
export class UnsupportedTransactionOutcomeError extends TransactionExecutionError {
  constructor(receipt: TransactionReceipt, submission?: SubmissionEvidence) {
    super(receipt, submission);
    this.name = "UnsupportedTransactionOutcomeError";
  }
}
export function assertTransactionSuccess(
  receipt: TransactionReceipt,
  submission?: SubmissionEvidence,
): asserts receipt is TransactionReceipt & {
  execution: { result: "return"; returnData: Uint8Array };
} {
  if (receipt.execution instanceof UnsupportedRpcValue)
    throw new UnsupportedTransactionOutcomeError(receipt, submission);
  if (receipt.execution.result !== "return")
    throw new TransactionExecutionError(receipt, submission);
}

/** A submit response that does not establish the currently supported admission outcome. */
export class UnsupportedTransactionAdmissionError extends Error {
  constructor(readonly response: RpcSendTransactionResult) {
    super("Transaction submission returned an unsupported admission outcome");
    this.name = "UnsupportedTransactionAdmissionError";
  }
}

/** Keep low-level future values intact, but never project them into an admitted hash. */
export function assertTransactionAdmission(
  response: RpcSendTransactionResult,
): void {
  if (response.admission !== "accepted")
    throw new UnsupportedTransactionAdmissionError(response);
}
export interface SubmissionEvidence {
  readonly signedTransaction: Uint8Array;
  readonly transactionHash: Uint8Array;
  readonly networkHash: Uint8Array;
}
/** Snapshot approved bytes before submission; accessor copies protect the retained record. */
export function createSubmissionEvidence(
  bytes: Uint8Array,
  network: Uint8Array,
): SubmissionEvidence {
  const signedTransaction = bytes.slice();
  const networkHash = network.slice();
  if (networkHash.length !== 32)
    throw new RangeError("networkHash must contain 32 bytes");
  const transactionHash = hashSignedTransaction(
    deserialize(signedTransaction, codec.SignedTransaction),
  );
  return Object.freeze({
    get signedTransaction() {
      return signedTransaction.slice();
    },
    get transactionHash() {
      return transactionHash.slice();
    },
    get networkHash() {
      return networkHash.slice();
    },
  });
}
export interface ExecutionResult {
  transactionHash: Uint8Array;
  receipt: TransactionReceipt;
  submission?: SubmissionEvidence;
}
/** Submission or observation stopped, preserving exact approved bytes and commitment. */
export class TransactionObservationError extends Error {
  constructor(
    readonly submission: SubmissionEvidence,
    cause: unknown,
    readonly submissionCause?: unknown,
    readonly knownCommitment?: KnownCommitment,
    readonly phase:
      | "beforeSubmission"
      | "submission"
      | "observation" = "observation",
  ) {
    super(
      `Could not complete transaction ${toBase58(submission.transactionHash)}`,
      { cause },
    );
    this.name = "TransactionObservationError";
  }
  get transactionHash(): Uint8Array {
    return this.submission.transactionHash;
  }
}
/** Submit once, then reconcile only by reads. No path replaces or repeats signed bytes. */
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
  let submissionCause: unknown;
  try {
    options?.signal?.throwIfAborted();
    if (timeoutMs === 0)
      throw new Error("Transaction submission timed out before dispatch");
  } catch (cause) {
    throw new TransactionObservationError(
      submission,
      cause,
      undefined,
      undefined,
      "beforeSubmission",
    );
  }
  try {
    await beforeDeadline(
      submit,
      deadline,
      options?.signal,
      () => new Error("Transaction submission timed out"),
    );
  } catch (cause) {
    if (
      wasDispatched?.() === false ||
      cause instanceof RpcRequestValidationError ||
      cause instanceof RpcCompatibilityError
    )
      throw new TransactionObservationError(
        submission,
        cause,
        undefined,
        undefined,
        "beforeSubmission",
      );
    if (
      cause instanceof NativeRpcError &&
      cause.decoded.classification === "known" &&
      (cause.decoded.data.kind === "invalidParams" ||
        cause.decoded.data.kind === "transactionInvalid" ||
        cause.decoded.data.kind === "transactionRejected")
    )
      throw new TransactionObservationError(
        submission,
        cause,
        undefined,
        undefined,
        "submission",
      );
    submissionCause = cause;
    if (options?.signal?.aborted || performance.now() >= deadline)
      throw new TransactionObservationError(
        submission,
        cause,
        submissionCause,
        undefined,
        "submission",
      );
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
    throw new TransactionObservationError(
      submission,
      cause,
      submissionCause,
      cause instanceof TransactionReceiptObservationError
        ? cause.knownCommitment
        : undefined,
    );
  }
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
    if (buffers == null)
      throw new ExecutionReturnUnavailableError(receipt, submission);
    if (buffers.length !== calls.length)
      throw new Error(
        `Returned ${buffers.length} child results; expected ${calls.length}`,
      );
    return calls.map((call, index) =>
      call.method.decodeReturn(buffers[index]!),
    ) as CallResults<T>;
  } catch (cause) {
    if (cause instanceof ExecutionReturnUnavailableError) throw cause;
    throw new ExecutionDecodeError(receipt, cause, submission);
  }
}

/** A committed successful execution whose return data could not be decoded. */
export class ExecutionDecodeError extends Error {
  constructor(
    readonly receipt: TransactionReceipt,
    cause: unknown,
    readonly submission?: SubmissionEvidence,
  ) {
    super(
      `Transaction ${toBase58(receipt.transactionHash)} committed, but result decoding failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "ExecutionDecodeError";
  }
}

/** Execution succeeded, but this wallet does not preserve child return buffers. */
export class ExecutionReturnUnavailableError extends Error {
  constructor(
    readonly receipt: TransactionReceipt,
    readonly submission?: SubmissionEvidence,
  ) {
    super(
      `Transaction ${toBase58(receipt.transactionHash)} committed successfully, but its wallet does not expose child return data`,
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
