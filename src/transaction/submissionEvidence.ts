import { codec, deserialize } from "@thruputchain/protocol";
import { hashSignedTransaction } from "../derivation/transactionHash.js";

/** Exact signed bytes, their transaction hash, and the signing network. */
export interface SubmissionEvidence {
  readonly signedTransaction: Uint8Array;
  readonly transactionHash: Uint8Array;
  readonly networkHash: Uint8Array;
}
/** Snapshot approved bytes before submission; accessor copies protect the retained record. */
export function createSubmissionEvidence(
  bytes: Uint8Array,
  network: Uint8Array,
): SubmissionEvidence {
  const signedTransaction = new Uint8Array(bytes);
  const networkHash = new Uint8Array(network);
  if (networkHash.length !== 32)
    throw new RangeError("networkHash must contain 32 bytes");
  const transactionHash = hashSignedTransaction(
    deserialize(signedTransaction, codec.SignedTransaction),
  );
  return Object.freeze({
    get signedTransaction() {
      return signedTransaction.slice();
    },
    get transactionHash() {
      return transactionHash.slice();
    },
    get networkHash() {
      return networkHash.slice();
    },
  });
}
