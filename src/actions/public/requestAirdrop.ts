import type { RpcClient } from "../../rpc/client.js";
import { rpcIncompatible } from "../../rpc/client.js";
import { rpcValueInvalid, UnsupportedRpcValue } from "../../rpc/codec.js";
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
  try {
    const network = await run((signal) =>
      client.getNetworkInfo({}, { signal }),
    );
    if (network.networkHash.some((v, i) => v !== request.networkHash[i]))
      throw rpcIncompatible("Funding endpoint network does not match");
    lastResponse = await run((signal) =>
      requestAirdropAttempt(
        client,
        { recipient: request.recipient, clientNonce: request.clientNonce },
        { signal },
      ),
    );
    if (lastResponse instanceof UnsupportedRpcValue)
      throw unsupported("Unsupported faucet response", lastResponse);
    if (lastResponse.attemptStatus === "succeeded") {
      if (lastResponse.execution instanceof UnsupportedRpcValue)
        throw unsupported(
          "Unsupported faucet execution outcome",
          lastResponse.execution,
        );
      return lastResponse;
    }
    if (!lastResponse.transactionHash)
      throw rpcValueInvalid("/result/transactionHash", lastResponse);
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
    const response =
      lastResponse instanceof UnsupportedRpcValue ? undefined : lastResponse;
    const native = isThruputError(cause, "nativeRpcError")
      ? cause.context.data
      : undefined;
    const nativeReceipt =
      native && "receipt" in native ? native.receipt : undefined;
    const observed = isThruputError(cause) ? cause.transaction : undefined;
    const receipt = observed?.receipt ?? nativeReceipt;
    const hash =
      receipt?.transactionHash ??
      observed?.hash ??
      (native && "transactionHash" in native
        ? native.transactionHash
        : undefined) ??
      response?.transactionHash;
    const reason: TransactionReason = options.signal?.aborted
      ? "cancelled"
      : timedOut
        ? "timeout"
        : native
          ? classifyReadError(cause) === "transient"
            ? "disconnected"
            : "nodeRejected"
          : "observationFailed";
    const transaction: TransactionFactsInput | undefined = receipt
      ? receiptFacts(receipt, "observationFailed")
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
            }
          : undefined;
    const committed =
      receipt ??
      (response?.attemptStatus === "succeeded" ? response : undefined);
    const knownCommitment = isThruputError(cause, "transactionOutcomeUnknown")
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

function unsupported(
  message: string,
  value: UnsupportedRpcValue,
): ThruputError<"rpcValueUnsupported"> {
  return new ThruputError("rpcValueUnsupported", message, {
    context: { value },
  });
}
