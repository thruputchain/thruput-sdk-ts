import {
  serialize,
  codec,
  sha256Hash,
  type SignedTransaction,
  type SHA256Hash,
} from "@thruputchain/protocol";
import type { RpcClient } from "../../rpc/client.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import {
  assertTransactionAdmission,
  createSubmissionEvidence,
} from "../../wallet/execution.js";
import { isThruputError } from "../../errors/thruputError.js";
import { withTransactionFacts } from "../../errors/transaction.js";
import {
  isCancellation,
  isLocalRequestError,
  reasonAfterDispatch,
  transactionOutcomeUnknown,
} from "../../wallet/transactionErrors.js";

/**
 * Serialize and submit once through the native RPC boundary.
 * Every failure has `transaction` facts with the signed bytes and destination
 * discovery network; that network does not prove the signing network of an
 * already-signed envelope. Unknown admission throws code
 * `transactionAdmissionUnsupported`. RPC and transport failures keep their
 * code, with outcome `unknown`, or `notSubmitted` for a local request error.
 */
export async function sendTransaction(
  client: Pick<RpcClient, "sendTransaction" | "discovery">,
  signedTx: SignedTransaction,
  options?: TransportRequestOptions,
): Promise<SHA256Hash> {
  const evidence = createSubmissionEvidence(
    serialize(signedTx, codec.SignedTransaction),
    client.discovery.network.networkHash,
  );
  let result;
  try {
    result = await client.sendTransaction(
      { signedTransaction: evidence.signedTransaction },
      options,
    );
  } catch (cause) {
    const signal = options?.signal;
    // An abort reason can be any value, including another transaction's error.
    if (isCancellation(cause, signal))
      throw transactionOutcomeUnknown(evidence, "cancelled", cause);
    const local = isLocalRequestError(cause, signal);
    const reason = local
      ? "requestInvalid"
      : reasonAfterDispatch(cause, signal);
    if (!isThruputError(cause))
      throw transactionOutcomeUnknown(evidence, reason, cause);
    throw withTransactionFacts(cause, {
      hash: evidence.transactionHash,
      outcome: local ? "notSubmitted" : "unknown",
      reason,
      submission: evidence,
    });
  }
  assertTransactionAdmission(result, evidence);
  return sha256Hash(result.transactionHash);
}
