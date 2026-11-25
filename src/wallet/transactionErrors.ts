import { toBase58 } from "../encoding.js";
import { isThruputError, ThruputError } from "../errors/thruputError.js";
import type { TransactionOutcomeUnknownContext } from "../errors/codes.js";
import type { TransactionReason } from "../errors/transaction.js";
import { classifyReadError } from "../transport/readError.js";
import { isLocalError } from "../rpc/localError.js";
import type { SubmissionEvidence } from "../transaction/submissionEvidence.js";

// Internal constructors for transaction errors. Public APIs re-export none of these.

/** The client did not dispatch the signed transaction. */
export function transactionNotSubmitted(
  submission: SubmissionEvidence,
  reason: TransactionReason,
  cause: unknown,
): ThruputError<"transactionNotSubmitted"> {
  return new ThruputError(
    "transactionNotSubmitted",
    `Transaction ${toBase58(submission.transactionHash)} was not submitted`,
    {
      cause,
      transaction: {
        hash: submission.transactionHash,
        outcome: "notSubmitted",
        reason,
        submission,
      },
    },
  );
}

/** Submission stopped, and the outcome is unknown. Never resend. */
export function transactionOutcomeUnknown(
  submission: SubmissionEvidence,
  reason: TransactionReason,
  cause: unknown,
  context: TransactionOutcomeUnknownContext = {},
): ThruputError<"transactionOutcomeUnknown"> {
  return new ThruputError(
    "transactionOutcomeUnknown",
    `Could not complete transaction ${toBase58(submission.transactionHash)}`,
    {
      context,
      cause,
      transaction: {
        hash: submission.transactionHash,
        outcome: "unknown",
        reason,
        submission,
      },
    },
  );
}

/** Add the signed bytes, and an earlier submission failure, to an observation error. */
export function withSubmission(
  error: unknown,
  submission: SubmissionEvidence,
  submissionError?: unknown,
): ThruputError<"transactionOutcomeUnknown"> {
  const extra = submissionError === undefined ? {} : { submissionError };
  if (!isThruputError(error, "transactionOutcomeUnknown") || !error.transaction)
    return transactionOutcomeUnknown(
      submission,
      "observationFailed",
      error,
      extra,
    );
  return new ThruputError("transactionOutcomeUnknown", error.shortMessage, {
    context: { ...error.context, ...extra },
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
    transaction: { ...error.transaction, submission },
  });
}

/**
 * True when the error is the caller's abort reason. An abort reason can be any
 * value, so never read its code as evidence about this transaction.
 */
export function isCancellation(
  cause: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return signal?.aborted === true && cause === signal.reason;
}

/**
 * True when a local check of this client rejected the request before dispatch.
 * The code alone is not proof: a transport can throw the same code after it
 * sent the request.
 */
export function isLocalRequestError(
  cause: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    !isCancellation(cause, signal) &&
    isLocalError(cause) &&
    (isThruputError(cause, "rpcRequestInvalid") ||
      isThruputError(cause, "rpcIncompatible"))
  );
}

/** A failure before dispatch, after signing and `onSigned`. */
export function reasonBeforeDispatch(
  cause: unknown,
  signal: AbortSignal | undefined,
): TransactionReason {
  if (signal?.aborted) return "cancelled";
  if (isLocalRequestError(cause, signal)) return "requestInvalid";
  if (isTimeout(cause)) return "timeout";
  return "notDispatched";
}

/** True when the node answered that it did not admit the transaction. */
export function isNodeRejection(cause: unknown): boolean {
  return (
    isThruputError(cause, "nativeRpcError") &&
    (cause.context.kind === "invalidParams" ||
      cause.context.kind === "transactionInvalid" ||
      cause.context.kind === "transactionRejected")
  );
}

/** A failure after dispatch. None of these proves that the node did not receive it. */
export function reasonAfterDispatch(
  cause: unknown,
  signal: AbortSignal | undefined,
): TransactionReason {
  if (signal?.aborted) return "cancelled";
  if (isNodeRejection(cause)) return "nodeRejected";
  if (isTimeout(cause)) return "timeout";
  if (classifyReadError(cause) === "transient") return "disconnected";
  return "submissionFailed";
}

/** A deadline error. Uses the web-standard `TimeoutError` name. */
export function timeoutError(message: string): DOMException {
  return new DOMException(message, "TimeoutError");
}

function isTimeout(cause: unknown): boolean {
  return (
    cause !== null &&
    typeof cause === "object" &&
    "name" in cause &&
    cause.name === "TimeoutError"
  );
}
