import { sha256 } from "@noble/hashes/sha2.js";
import { codec, serialize, sha256Hash } from "@thruputchain/protocol";
import type { SHA256Hash, SignedTransaction } from "@thruputchain/protocol";

/**
 * The transaction's network-wide identifier: `sha256(txs(stx.tx))`.
 *
 * The hash covers the {@link https://github.com/groundhogchain/protocol | protocol}
 * `Transaction` only — deliberately not the signatures wrapped around it. That
 * keeps the identifier stable under signature malleability, so a third party
 * cannot change the identity of an in-flight transaction by re-encoding its
 * signatures, and it matches what the chain uses to index transactions.
 *
 * Not to be confused with the signature preimage, which is a different message
 * and does carry a domain separator and the network hash — see
 * {@link transactionSignaturePreimage}. This is what you look a transaction up
 * by; that is what you sign.
 */
export function hashSignedTransaction(stx: SignedTransaction): SHA256Hash {
  const bytes = serialize(stx.tx, codec.Transaction);
  return sha256Hash(sha256(bytes));
}
