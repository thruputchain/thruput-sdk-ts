import { toBase58, addressFromBase58 } from "../../encoding.js";
import type { ContractAddress } from "@thruputchain/protocol";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { BalanceResponse } from "../../types/rpc.js";

import { parseDecimal, parseHeight, I128_MAX } from "../decimal.js";

interface RawBalanceResponse {
  address: string;
  rawBalance: string;
  height: string;
}

/**
 * Return the HOG balance for an address.
 *
 * The raw balance is returned as a `bigint`; display code should apply any
 * token-specific decimal formatting separately.
 */
export async function getBalance(
  transport: Transport,
  address: ContractAddress,
  options?: TransportRequestOptions,
): Promise<BalanceResponse> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_getBalance",
    [toBase58(address)],
    options,
  );

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid balance response");
  }

  const balance = result as RawBalanceResponse;

  return {
    address: addressFromBase58(balance.address),
    rawBalance: parseDecimal(balance.rawBalance, "rawBalance", 0n, I128_MAX),
    height: parseHeight(balance.height),
  };
}
