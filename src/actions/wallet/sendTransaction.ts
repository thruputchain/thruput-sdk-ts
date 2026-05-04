import type { SignedTransaction, SHA256Hash } from "@groundhogchain/protocol";
import { serialize, codec } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import { toHex0x, hashFromHex } from "../hex.js";

export async function sendTransaction(
  transport: Transport,
  signedTx: SignedTransaction,
): Promise<SHA256Hash> {
  const bytes = serialize(signedTx, codec.SignedTransaction);
  const hex = toHex0x(bytes);
  const result = await transport.request<{ txHash: string }>(
    "groundhog_sendRawTransaction",
    [hex],
  );
  return hashFromHex(result.txHash);
}
