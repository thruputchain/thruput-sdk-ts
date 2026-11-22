import { UnsupportedRpcValue } from "../rpc/codec.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { SubmissionEvidence } from "../transaction/submissionEvidence.js";

/**
 * What the client knows about a transaction's execution.
 *
 * - `succeeded`: the receipt shows success. The error is about a later step.
 * - `failed`: the receipt shows failed execution.
 * - `notSubmitted`: the client did not dispatch the transaction.
 * - `unknown`: the client cannot know. **Never resend.** Observe `hash` instead.
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
 * | `notDispatched` | The transport did not send the request. |
 * | `requestInvalid` | A local request or compatibility check failed before dispatch. |
 * | `nodeRejected` | The node answered `invalidParams`, `transactionInvalid`, or `transactionRejected`, or stopped a funding attempt. |
 * | `submissionFailed` | Submission failed in a way that does not prove the node did not receive the transaction. |
 * | `disconnected` | The time budget ended after the last read failed. |
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
  const [outcome, reason]: [TransactionOutcome, TransactionReason] =
    execution instanceof UnsupportedRpcValue
      ? ["unknown", "outcomeUnsupported"]
      : execution.result === "return"
        ? ["succeeded", successReason]
        : execution.result === "abort"
          ? ["failed", "aborted"]
          : execution.result === "fault"
            ? ["failed", "faulted"]
            : ["failed", "executionFailed"];
  return {
    hash: receipt.transactionHash,
    outcome,
    reason,
    receipt,
    ...(submission ? { submission } : {}),
  };
}
