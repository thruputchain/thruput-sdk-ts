import type { Transaction, SignedTransaction } from "@thruputchain/protocol";
import { serialize, deserialize, codec } from "@thruputchain/protocol";

/** Serialize an unsigned transaction to its canonical protocol bytes. */
export function serializeTransaction(tx: Transaction): Uint8Array {
  return serialize(tx, codec.Transaction);
}

/** Decode an unsigned transaction from canonical protocol bytes. */
export function deserializeTransaction(data: Uint8Array): Transaction {
  return deserialize(data, codec.Transaction);
}

/** Serialize a signed transaction to the bytes accepted by the JSON-RPC API. */
export function serializeSignedTransaction(stx: SignedTransaction): Uint8Array {
  return serialize(stx, codec.SignedTransaction);
}

/** Decode a signed transaction from canonical protocol bytes. */
export function deserializeSignedTransaction(
  data: Uint8Array,
): SignedTransaction {
  return deserialize(data, codec.SignedTransaction);
}
