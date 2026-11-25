import { isUnsupportedRpcValue } from "../rpc/unsupported.js";
import { toBase58 } from "../encoding.js";
import { isThruputError, ThruputError } from "./thruputError.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { SubmissionEvidence } from "../transaction/submissionEvidence.js";

/**
 * What the client knows about a transaction's execution.
 *
 * - `succeeded`: the receipt shows success. The error is about a later step.
 * - `failed`: the receipt shows failed execution.
 * - `notSubmitted`: this call did not dispatch the transaction.
 * - `unknown`: the client cannot know. **Never resend.** Observe `hash` instead.
 *
 * `notSubmitted` covers this call only. A request with an explicit nonce and
 * expiry signs to the same bytes each time, so an earlier call may have sent
 * them. The provider wallet remembers the hashes it sent and reports `unknown`
 * for them. The signer wallet does not, because a long-running process would
 * keep every hash. When you repeat such a request, observe its hash before you
 * treat it as unsent.
 */
export type TransactionOutcome = (typeof transactionOutcomes)[number];

/**
 * Why the operation stopped. Use it for messages and diagnostics; decide whether
 * to resend from {@link TransactionOutcome} only. The same reason can occur
 * with different outcomes: a timeout before dispatch is `notSubmitted`, and a
 * timeout during observation is `unknown`.
 *
 * | Reason | Meaning |
 * | --- | --- |
 * | `aborted` | The receipt shows a contract abort. |
 * | `faulted` | The receipt shows a fault. |
 * | `executionFailed` | The receipt shows another execution failure. The receipt has the exact result. |
 * | `resultUndecodable` | Execution succeeded, but its return data did not decode. |
 * | `resultUnavailable` | Execution succeeded, but the wallet does not keep child return data. |
 * | `cancelled` | The caller's signal was aborted. |
 * | `timeout` | The time budget ended. |
 * | `persistenceFailed` | The `onSigned` callback rejected, so the client did not submit. |
 * | `notDispatched` | This call did not send the request. With outcome `unknown`, an earlier call may have sent the same bytes. |
 * | `requestInvalid` | A local request or compatibility check failed before dispatch. |
 * | `nodeRejected` | The node answered `invalidParams`, `transactionInvalid`, or `transactionRejected`, or stopped a funding attempt. |
 * | `submissionFailed` | Submission failed in a way that does not prove the node did not receive the transaction. |
 * | `disconnected` | A transient network or node failure: during submission, or the last read before the time budget ended. |
 * | `statusUnknown` | The time budget ended, and the node's last status was `unknown` or unsupported. |
 * | `recentFailure` | The time budget ended, and the node's last status was `recentFailure`. |
 * | `networkChanged` | The observation endpoint reported a different network. |
 * | `commitmentConflict` | The node reported two commitment heights for one transaction. |
 * | `observationFailed` | A permanent read failure or an invalid response stopped observation. |
 * | `admissionUnsupported` | Submission returned an admission value this client does not support. |
 * | `outcomeUnsupported` | The receipt has an execution value this client does not support. |
 */
export type TransactionReason = (typeof transactionReasons)[number];

/** Every {@link TransactionOutcome}, for example to validate stored values. */
export const transactionOutcomes = Object.freeze([
  "succeeded",
  "failed",
  "notSubmitted",
  "unknown",
] as const);

/** Every {@link TransactionReason}, for example to validate stored values. */
export const transactionReasons = Object.freeze([
  "aborted",
  "faulted",
  "executionFailed",
  "resultUndecodable",
  "resultUnavailable",
  "cancelled",
  "timeout",
  "persistenceFailed",
  "notDispatched",
  "requestInvalid",
  "nodeRejected",
  "submissionFailed",
  "disconnected",
  "statusUnknown",
  "recentFailure",
  "networkChanged",
  "commitmentConflict",
  "observationFailed",
  "admissionUnsupported",
  "outcomeUnsupported",
] as const);

/**
 * Facts about one signed transaction, present on every {@link ThruputError}
 * raised after signing.
 *
 * @example
 * ```ts
 * try {
 *   await wallet.executeAndWait(request);
 * } catch (error) {
 *   if (isThruputError(error) && error.transaction?.outcome === "unknown") {
 *     // Do not send it again. Save the hash and observe it later.
 *     saveForLaterObservation(error.transaction.hash);
 *   }
 *   throw error;
 * }
 * ```
 */
export interface TransactionFacts {
  /** Transaction hash. Each read returns a new copy. */
  readonly hash: Uint8Array;
  readonly outcome: TransactionOutcome;
  readonly reason: TransactionReason;
  /** The committed receipt, when the client has one. */
  readonly receipt?: TransactionReceipt;
  /** The exact signed bytes and network, when the client has them. */
  readonly submission?: SubmissionEvidence;
}

/** Input for {@link TransactionFacts}. Byte values are copied. */
export interface TransactionFactsInput {
  readonly hash: Uint8Array;
  readonly outcome: TransactionOutcome;
  readonly reason: TransactionReason;
  readonly receipt?: TransactionReceipt;
  readonly submission?: SubmissionEvidence;
}

/** Reason for each known failed execution result. */
const failedResults = {
  abort: "aborted",
  fault: "faulted",
  nonDeterministicError: "executionFailed",
  failedGasSponsorship: "executionFailed",
  other: "executionFailed",
} as const satisfies Record<string, TransactionReason>;

/**
 * Facts from a committed receipt. A successful execution uses
 * `successReason`, because the error is about a later step.
 * @internal
 */
export function receiptFacts(
  receipt: TransactionReceipt,
  successReason: TransactionReason,
  submission?: SubmissionEvidence,
): TransactionFactsInput {
  const { execution } = receipt;
  const result = isUnsupportedRpcValue(execution)
    ? undefined
    : execution.result;
  // Only known results count as failed; anything else, including a value from
  // another package copy, is an unsupported outcome.
  const [outcome, reason]: [TransactionOutcome, TransactionReason] =
    result === "return"
      ? ["succeeded", successReason]
      : result !== undefined && Object.hasOwn(failedResults, result)
        ? ["failed", failedResults[result as keyof typeof failedResults]]
        : ["unknown", "outcomeUnsupported"];
  return {
    hash: receipt.transactionHash,
    outcome,
    reason,
    receipt,
    ...(submission ? { submission } : {}),
  };
}

/**
 * Execution succeeded, but its return data did not decode.
 * @internal
 */
export function transactionResultUndecodable(
  receipt: TransactionReceipt,
  cause: unknown,
  submission?: SubmissionEvidence,
): ThruputError<"transactionResultUndecodable"> {
  // Adapters are application code, so their messages stay in `cause` only.
  return new ThruputError(
    "transactionResultUndecodable",
    `Transaction ${toBase58(receipt.transactionHash)} committed, but result decoding failed`,
    {
      cause,
      transaction: receiptFacts(receipt, "resultUndecodable", submission),
    },
  );
}

/**
 * Add transaction facts to a `ThruputError` that has none, keeping its code.
 * An error with facts for another transaction, for example an abort reason, is
 * wrapped instead, so its facts never describe this transaction.
 * @internal
 */
export function withTransactionFacts(
  error: unknown,
  transaction: TransactionFactsInput,
): unknown {
  if (!isThruputError(error)) return error;
  if (error.transaction) {
    if (bytesEqual(error.transaction.hash, transaction.hash)) return error;
    const notSubmitted = transaction.outcome === "notSubmitted";
    return new ThruputError(
      notSubmitted ? "transactionNotSubmitted" : "transactionOutcomeUnknown",
      `Could not complete transaction ${toBase58(transaction.hash)}`,
      {
        cause: error,
        transaction: {
          ...transaction,
          outcome: notSubmitted ? "notSubmitted" : "unknown",
        },
      },
    );
  }
  return new ThruputError(error.code, error.shortMessage, {
    context: error.context,
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
    transaction,
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length && left.every((byte, i) => byte === right[i])
  );
}
