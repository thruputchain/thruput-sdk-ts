import type { SignedTransaction, SHA256Hash } from "@thruputchain/protocol";
import { serialize, codec } from "@thruputchain/protocol";
import type { Transport } from "../../transport/types.js";
import { toHex0x, hashFromHex } from "../hex.js";

/**
 * Submit a signed transaction and return its transaction hash.
 *
 * This action serializes the signed transaction and sends it through
 * `groundhog_sendRawTransaction`.
 *
 * @example
 * ```ts
 * const txHash = await sendTransaction(transport, signedTx);
 * ```
 */
export async function sendTransaction(
  transport: Transport,
  signedTx: SignedTransaction,
): Promise<SHA256Hash> {
  const bytes = serialize(signedTx, codec.SignedTransaction);
  const hex = toHex0x(bytes);
  const result = await transport.request<unknown>(
    "groundhog_sendRawTransaction",
    [hex],
  );
  if (typeof result !== "string") {
    throw new Error("Invalid send transaction response: expected tx hash");
  }
  return hashFromHex(result);
}
