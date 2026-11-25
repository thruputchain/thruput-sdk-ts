import type { RpcClient } from "../../rpc/client.js";
import { rpcIncompatible } from "../../rpc/client.js";
import {
  isUnsupportedRpcValue,
  type UnsupportedRpcValue,
} from "../../rpc/codec.js";
import { isThruputError, ThruputError } from "../../errors/thruputError.js";
import type {
  TransactionFactsInput,
  TransactionReason,
} from "../../errors/transaction.js";
import { receiptFacts } from "../../errors/transaction.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import type {
  AirdropAttemptRequest,
  AirdropResponse,
  AirdropSucceeded,
} from "../../types/rpc.js";
import { waitForTransactionReceipt } from "./waitForTransactionReceipt.js";
import { assertTransactionSuccess } from "../../wallet/execution.js";
import { classifyReadError } from "../../transport/readError.js";
import { isCancellation } from "../../wallet/transactionErrors.js";
import {
  createSubmissionEvidence,
  type SubmissionEvidence,
} from "../../transaction/submissionEvidence.js";
import { beforeDeadline, validateTimer } from "../deadline.js";

export interface RequestAirdropOptions {
  readonly recipient: Uint8Array;
  readonly clientNonce?: Uint8Array;
  readonly expectedNetworkHash?: Uint8Array;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
/** Perform exactly one faucet call. It neither polls nor repeats an ambiguous attempt. */
export async function requestAirdropAttempt(
  client: Pick<RpcClient, "faucet_requestAirdrop">,
  request: AirdropAttemptRequest,
  options: TransportRequestOptions = {},
): Promise<AirdropResponse> {
  return client.faucet_requestAirdrop(request, options);
}
/**
 * Call the faucet once, then observe a returned pending hash using read-only calls.
 * When funding stops, throws code `fundingStopped` without permission to call the
 * faucet again. `transaction` is present when the faucet identified a
 * transaction; reconcile with `context.request.clientNonce`.
 */
export async function requestAirdrop(
  client: RpcClient,
  options: RequestAirdropOptions,
): Promise<AirdropSucceeded> {
  const timeoutMs = options.timeoutMs ?? 60000;
  validateTimer(timeoutMs, "timeoutMs");
  const request = {
    recipient: new Uint8Array(options.recipient),
    clientNonce: options.clientNonce
      ? new Uint8Array(options.clientNonce)
      : crypto.getRandomValues(new Uint8Array(16)),
    networkHash: new Uint8Array(
      options.expectedNetworkHash ?? client.discovery.network.networkHash,
    ),
  };
  if (
    request.recipient.length !== 32 ||
    request.networkHash.length !== 32 ||
    request.clientNonce.length < 1 ||
    request.clientNonce.length > 32
  )
    throw new RangeError(
      "Funding requires 32-byte addresses/hashes and a 1–32 byte nonce",
    );
  client.requireMethods([
    "faucet_requestAirdrop",
    "getNetworkInfo",
    "getTransactionReceipt",
    "getTransactionStatus",
  ]);
  const deadline = performance.now() + timeoutMs;
  let lastResponse: AirdropResponse | undefined;
  let timedOut = false;
  const timeout = () => {
    timedOut = true;
    return new DOMException("Funding observation timed out", "TimeoutError");
  };
  const run = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    beforeDeadline(operation, deadline, options.signal, timeout);
  // Evidence must come from this faucet call or from observing its hash.
  let phase: "network" | "faucet" | "observe" = "network";
  try {
    const network = await run((signal) =>
      client.getNetworkInfo({}, { signal }),
    );
    if (network.networkHash.some((v, i) => v !== request.networkHash[i]))
      throw rpcIncompatible(
        "network",
        "Funding endpoint network does not match",
      );
    phase = "faucet";
    lastResponse = await run((signal) =>
      requestAirdropAttempt(
        client,
        { recipient: request.recipient, clientNonce: request.clientNonce },
        { signal },
      ),
    );
    if (isUnsupportedRpcValue(lastResponse))
      throw unsupported("Unsupported faucet response", lastResponse);
    if (lastResponse.attemptStatus === "succeeded") {
      if (isUnsupportedRpcValue(lastResponse.execution))
        throw unsupported(
          "Unsupported faucet execution outcome",
          lastResponse.execution,
        );
      return lastResponse;
    }
    // A pending attempt may not have a transaction yet. That is valid, but
    // there is no hash to observe, so stop and keep the response.
    if (!lastResponse.transactionHash)
      throw new Error("The faucet attempt is pending without a transaction");
    phase = "observe";
    const receipt = await waitForTransactionReceipt(
      client,
      lastResponse.transactionHash,
      {
        expectedNetworkHash: request.networkHash,
        timeoutMs: Math.max(0, deadline - performance.now()),
        signal: options.signal,
      },
    );
    assertTransactionSuccess(receipt);
    return {
      attemptStatus: "succeeded",
      recipient: lastResponse.recipient,
      rawAmount: lastResponse.rawAmount,
      transactionHash: receipt.transactionHash,
      blockHeight: receipt.blockHeight,
      execution: receipt.execution,
    };
  } catch (cause) {
    // An abort reason can be any value, so take no evidence from it.
    const cancelled = isCancellation(cause, options.signal);
    const response = isUnsupportedRpcValue(lastResponse)
      ? undefined
      : lastResponse;
    const native =
      !cancelled &&
      phase === "faucet" &&
      isThruputError(cause, "nativeRpcError")
        ? cause.context.data
        : undefined;
    const observed =
      !cancelled &&
      phase === "observe" &&
      isThruputError(cause) &&
      cause.transaction &&
      response?.transactionHash &&
      bytesEqual(cause.transaction.hash, response.transactionHash)
        ? cause.transaction
        : undefined;
    const receipt =
      observed?.receipt ??
      (native && "receipt" in native ? native.receipt : undefined);
    const hash =
      receipt?.transactionHash ??
      observed?.hash ??
      (native && "transactionHash" in native
        ? native.transactionHash
        : undefined) ??
      response?.transactionHash;
    // The native reader checked these signed bytes against the hash.
    const signed =
      native && "signedTransaction" in native
        ? native.signedTransaction
        : undefined;
    const submission =
      signed && hash
        ? fundingSubmission(signed, request.networkHash, hash)
        : undefined;
    const reason: TransactionReason = options.signal?.aborted
      ? "cancelled"
      : timedOut
        ? "timeout"
        : native
          ? classifyReadError(cause) === "transient"
            ? "disconnected"
            : "nodeRejected"
          : "observationFailed";
    const extra = submission ? { submission } : {};
    const transaction: TransactionFactsInput | undefined = receipt
      ? { ...receiptFacts(receipt, reason), ...extra }
      : observed
        ? {
            hash: observed.hash,
            outcome: observed.outcome,
            reason: observed.reason,
          }
        : hash
          ? {
              hash,
              outcome: "unknown",
              // A succeeded attempt reaches here only with an unsupported execution value.
              reason:
                response?.attemptStatus === "succeeded"
                  ? "outcomeUnsupported"
                  : reason,
              ...extra,
            }
          : undefined;
    const committed =
      receipt ??
      (response?.attemptStatus === "succeeded" ? response : undefined);
    const knownCommitment =
      observed && isThruputError(cause, "transactionOutcomeUnknown")
        ? cause.context.knownCommitment
        : committed
          ? {
              networkHash: request.networkHash.slice(),
              transactionHash: new Uint8Array(committed.transactionHash),
              blockHeight: committed.blockHeight,
            }
          : undefined;
    throw new ThruputError("fundingStopped", "Funding observation stopped", {
      context: {
        request,
        ...(lastResponse === undefined ? {} : { lastResponse }),
        ...(knownCommitment ? { knownCommitment } : {}),
      },
      cause,
      ...(transaction ? { transaction } : {}),
    });
  }
}

/** Signed faucet bytes as submission evidence, when they match the hash. */
function fundingSubmission(
  signedTransaction: Uint8Array,
  networkHash: Uint8Array,
  hash: Uint8Array,
): SubmissionEvidence | undefined {
  try {
    const evidence = createSubmissionEvidence(signedTransaction, networkHash);
    return bytesEqual(evidence.transactionHash, hash) ? evidence : undefined;
  } catch {
    return undefined;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length && left.every((byte, i) => byte === right[i])
  );
}

function unsupported(
  message: string,
  value: UnsupportedRpcValue,
): ThruputError<"rpcValueUnsupported"> {
  return new ThruputError("rpcValueUnsupported", message, {
    context: { value },
  });
}
