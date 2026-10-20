import type { RpcClient } from "../../rpc/client.js";
import { NativeRpcError } from "../../rpc/errorReader.js";
import { RpcCompatibilityError } from "../../rpc/client.js";
import { UnsupportedRpcValue } from "../../rpc/codec.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import type {
  AirdropAttemptRequest,
  AirdropResponse,
  AirdropSucceeded,
} from "../../types/rpc.js";
import {
  waitForTransactionReceipt,
  TransactionReceiptObservationError,
  type KnownCommitment,
} from "./waitForTransactionReceipt.js";
import {
  TransactionExecutionError,
  assertTransactionSuccess,
} from "../../wallet/execution.js";
import { beforeDeadline, validateTimer } from "../deadline.js";

export interface RequestAirdropOptions {
  readonly recipient: Uint8Array;
  readonly clientNonce?: Uint8Array;
  readonly expectedNetworkHash?: Uint8Array;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
/** Funding stopped without permission to call the faucet again. */
export class FundingObservationError extends Error {
  constructor(
    readonly request: AirdropAttemptRequest & { networkHash: Uint8Array },
    readonly lastResponse: AirdropResponse | undefined,
    cause: unknown,
    readonly knownCommitment?: KnownCommitment,
  ) {
    super("Funding observation stopped", { cause });
    this.name = "FundingObservationError";
  }
}
/** Perform exactly one faucet call. It neither polls nor repeats an ambiguous attempt. */
export async function requestAirdropAttempt(
  client: Pick<RpcClient, "faucet_requestAirdrop">,
  request: AirdropAttemptRequest,
  options: TransportRequestOptions = {},
): Promise<AirdropResponse> {
  return client.faucet_requestAirdrop(request, options);
}
/** Call the faucet once, then observe a returned pending hash using read-only calls. */
export async function requestAirdrop(
  client: RpcClient,
  options: RequestAirdropOptions,
): Promise<AirdropSucceeded> {
  const timeoutMs = options.timeoutMs ?? 60000;
  validateTimer(timeoutMs, "timeoutMs");
  const request = {
    recipient: options.recipient.slice(),
    clientNonce:
      options.clientNonce?.slice() ??
      crypto.getRandomValues(new Uint8Array(16)),
    networkHash: (
      options.expectedNetworkHash ?? client.discovery.network.networkHash
    ).slice(),
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
  const timeout = () => new Error("Funding observation timed out");
  const run = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    beforeDeadline(operation, deadline, options.signal, timeout);
  try {
    const network = await run((signal) =>
      client.getNetworkInfo({}, { signal }),
    );
    if (network.networkHash.some((v, i) => v !== request.networkHash[i]))
      throw new RpcCompatibilityError(
        "Funding endpoint network does not match",
      );
    lastResponse = await run((signal) =>
      requestAirdropAttempt(
        client,
        { recipient: request.recipient, clientNonce: request.clientNonce },
        { signal },
      ),
    );
    if (lastResponse instanceof UnsupportedRpcValue) throw lastResponse;
    if (lastResponse.attemptStatus === "succeeded") {
      if (lastResponse.execution instanceof UnsupportedRpcValue)
        throw lastResponse.execution;
      return lastResponse;
    }
    if (!lastResponse.transactionHash)
      throw new Error("Pending funding did not identify a transaction");
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
    const nativeReceipt =
      cause instanceof NativeRpcError &&
      cause.decoded.classification === "known" &&
      "receipt" in cause.decoded.data
        ? cause.decoded.data.receipt
        : undefined;
    throw new FundingObservationError(
      request,
      lastResponse,
      cause,
      cause instanceof TransactionReceiptObservationError
        ? cause.knownCommitment
        : cause instanceof TransactionExecutionError
          ? {
              networkHash: request.networkHash.slice(),
              transactionHash: cause.receipt.transactionHash.slice(),
              blockHeight: cause.receipt.blockHeight,
            }
          : nativeReceipt
            ? {
                networkHash: request.networkHash.slice(),
                transactionHash: nativeReceipt.transactionHash.slice(),
                blockHeight: nativeReceipt.blockHeight,
              }
            : undefined,
    );
  }
}
