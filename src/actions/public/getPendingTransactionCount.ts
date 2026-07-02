import type { Transport } from "../../transport/types.js";

/** Return the number of transactions currently pending in the mempool. */
export async function getPendingTransactionCount(
  transport: Transport,
): Promise<bigint> {
  const result = await transport.request<unknown>(
    "groundhog_pendingTransactionCount",
  );
  if (typeof result !== "number" && typeof result !== "string") {
    throw new Error("Invalid pending transaction count response");
  }

  const count = BigInt(result);
  if (count < 0n) throw new Error("Invalid pending transaction count response");
  return count;
}
