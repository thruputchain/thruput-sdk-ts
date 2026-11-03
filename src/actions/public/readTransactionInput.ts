import { sha256 } from "@noble/hashes/sha2.js";
import {
  codec,
  deserialize,
  serialize,
  type Transaction,
} from "@thruputchain/protocol";
import { bytesEqual } from "../../contract/event.js";
import type { RpcClient } from "../../rpc/client.js";
import { UnsupportedRpcValue } from "../../rpc/codec.js";
import type { TransportRequestOptions } from "../../transport/types.js";

/** Canonical retained input verified against the requested public transaction hash. */
export type VerifiedTransactionInput =
  | {
      status: "available";
      transactionHash: Uint8Array;
      blockHeight: bigint;
      transactionXdr: Uint8Array;
      transaction: Transaction;
    }
  | { status: "unavailable" }
  | UnsupportedRpcValue;

/**
 * Read and authenticate a retained Transaction, including its root invocation.
 * Unavailable does not prove nonexecution. A matching body hash authenticates
 * neither signatures nor the reported block height, and does not imply success.
 */
export async function readTransactionInput(
  client: RpcClient,
  request: { transactionHash: Uint8Array },
  options?: TransportRequestOptions,
): Promise<VerifiedTransactionInput> {
  client.requireMethods(["getTransactionInput"]);
  const hash = new Uint8Array(request.transactionHash);
  const result = await client.getTransactionInput(
    { transactionHash: hash },
    options,
  );
  if (result instanceof UnsupportedRpcValue || result.status === "unavailable")
    return result;
  if (result.transactionXdr.length > 4 * 1024 * 1024)
    throw new Error("Transaction input exceeds 4 MiB");
  if (
    !bytesEqual(result.transactionHash, hash) ||
    !bytesEqual(sha256(result.transactionXdr), hash)
  ) {
    throw new Error("Retained transaction input hash mismatch");
  }
  const transaction = deserialize(result.transactionXdr, codec.Transaction);
  if (
    !bytesEqual(
      serialize(transaction, codec.Transaction),
      result.transactionXdr,
    )
  ) {
    throw new Error("Noncanonical Transaction XDR");
  }
  return { ...result, transaction };
}
