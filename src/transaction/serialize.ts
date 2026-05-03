import type { Transaction, SignedTransaction } from "@groundhogchain/protocol";
import { serialize, deserialize, codec } from "@groundhogchain/protocol";

export function serializeTransaction(tx: Transaction): Uint8Array {
  return serialize(tx, codec.Transaction);
}

export function deserializeTransaction(data: Uint8Array): Transaction {
  return deserialize(data, codec.Transaction);
}

export function serializeSignedTransaction(stx: SignedTransaction): Uint8Array {
  return serialize(stx, codec.SignedTransaction);
}

export function deserializeSignedTransaction(
  data: Uint8Array,
): SignedTransaction {
  return deserialize(data, codec.SignedTransaction);
}
