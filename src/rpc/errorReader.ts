import { codec, deserialize } from "@thruputchain/protocol";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { JsonRpcError } from "../transport/http.js";
import { decodeErrorData, RpcDecodingError } from "./codec.js";
import type { RpcErrorData } from "./generated.js";

export type DecodedRpcError =
  | { classification: "known"; data: RpcErrorData; raw: unknown }
  | { classification: "unclassified"; raw: unknown };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Classifies method-specific causes without granting retries. Unknown, malformed,
 * or contradictory evidence stays unclassified with the complete raw error.
 * Supply the locally computed/requested hash to bind admission or observation evidence.
 */
export function decodeRpcError(
  method: string,
  raw: unknown,
  expectedTransactionHash?: Uint8Array,
): DecodedRpcError {
  const unclassified = (): DecodedRpcError => ({
    classification: "unclassified",
    raw,
  });
  if (
    !record(raw) ||
    typeof raw.code !== "number" ||
    !Number.isInteger(raw.code) ||
    raw.code < -2147483648 ||
    raw.code > 2147483647 ||
    typeof raw.message !== "string"
  )
    return unclassified();
  try {
    const data = decodeErrorData(method, raw.code, raw.data) as RpcErrorData;
    if (!validFunding(data)) return unclassified();
    if (expectedTransactionHash) {
      if (
        method === "sendTransaction" &&
        "transactionHash" in data &&
        data.transactionHash &&
        !equal(data.transactionHash, expectedTransactionHash)
      )
        return unclassified();
      if (
        method === "getTransactionReceipt" &&
        "observation" in data &&
        data.observation &&
        !equal(data.observation.transactionHash, expectedTransactionHash)
      )
        return unclassified();
    }
    return { classification: "known", data, raw };
  } catch (error) {
    if (error instanceof RpcDecodingError) return unclassified();
    throw error;
  }
}

function validFunding(data: RpcErrorData): boolean {
  if (
    data.kind !== "fundingAttemptStopped" &&
    data.kind !== "localFundingUnresolved"
  )
    return true;
  if (data.signedTransaction) {
    try {
      if (
        !data.transactionHash ||
        !equal(
          hashSignedTransaction(
            deserialize(data.signedTransaction, codec.SignedTransaction),
          ),
          data.transactionHash,
        )
      )
        return false;
    } catch {
      return false;
    }
  }
  if (data.kind === "fundingAttemptStopped")
    return (
      !data.receipt ||
      (!!data.transactionHash &&
        equal(data.receipt.transactionHash, data.transactionHash))
    );
  if (data.cause) {
    if (!validFunding(data.cause)) return false;
    if (
      data.cause.transactionHash &&
      !equal(data.cause.transactionHash, data.transactionHash)
    )
      return false;
    if (
      data.cause.signedTransaction &&
      !equal(data.cause.signedTransaction, data.signedTransaction)
    )
      return false;
  }
  return true;
}

/** A native RPC failure retains the transport error and a conservative typed interpretation. */
export class NativeRpcError extends JsonRpcError {
  readonly decoded: DecodedRpcError;
  constructor(
    error: JsonRpcError,
    method: string,
    expectedTransactionHash?: Uint8Array,
  ) {
    super(error.code, error.rpcMessage, error.data, method, error.raw);
    this.name = "NativeRpcError";
    this.decoded = decodeRpcError(method, error.raw, expectedTransactionHash);
  }
}
