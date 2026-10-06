import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";

import { parseU64 } from "../decimal.js";

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
  return parseU64(result, "pending transaction count");
}
