import type { ContractAddress } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { BalanceResponse } from "../../types/rpc.js";
import { addressFromHex, toHex0x } from "../hex.js";
import { requireObject, requireString, requireUint } from "../parse.js";

/**
 * Return the HOG balance for an address.
 *
 * The raw balance is returned as a `bigint`; display code should apply any
 * token-specific decimal formatting separately.
 */
export async function getBalance(
  transport: Transport,
  address: ContractAddress,
): Promise<BalanceResponse> {
  const result = await transport.request<unknown>("groundhog_getBalance", [
    toHex0x(address),
  ]);

  const balance = requireObject(result, "balance");

  return {
    address: addressFromHex(requireString(balance, "address", "balance")),
    rawBalance: requireUint(balance, "rawBalance", "balance"),
    height: requireUint(balance, "height", "balance"),
  };
}
