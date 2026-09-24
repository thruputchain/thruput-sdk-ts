import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";

/** Return the number of transactions currently pending in the mempool. */
export async function getPendingTransactionCount(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<bigint> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_pendingTransactionCount",
    undefined,
    options,
  );
  if (typeof result !== "number" && typeof result !== "string") {
    throw new Error("Invalid pending transaction count response");
  }

  const count = BigInt(result);
  if (count < 0n) throw new Error("Invalid pending transaction count response");
  return count;
}
