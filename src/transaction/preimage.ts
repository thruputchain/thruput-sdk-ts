import type { NetworkHash, Transaction } from "@groundhogchain/protocol";
import { codec, serialize } from "@groundhogchain/protocol";
import { TRANSACTION } from "../derivation/domainSeparator.js";

/**
 * The message every transaction signature covers:
 *
 * ```text
 * cxs(DomainSeparator("Transaction")) || networkHash || txs(tx)
 * ```
 *
 * The domain separator keeps a transaction signature from being reinterpreted
 * as a signature over some other object whose encoding a transaction could be
 * made to imitate. The network hash binds the signature to a single network, so
 * a transaction signed for one chain cannot be replayed on another that happens
 * to carry the same address with the same auth data.
 *
 * Note the two encodings: the prefix is CXS, which is how a `DomainSeparator`
 * is encoded everywhere, while the transaction itself is classic XDR. The
 * network hash is a fixed 32-byte opaque, whose CXS and XDR encodings are
 * identical, so it is written verbatim.
 *
 * The result is signed directly — Ed25519 does its own hashing, so there is no
 * pre-hash here. It must match the C++ validator's
 * `hogd::transaction_signature_preimage` and the Rust
 * `groundhog_domain_separator::transaction_signature_preimage` byte for byte,
 * or every signature is rejected.
 *
 * {@link signTransaction} calls this; reach for it directly only when handing
 * bytes to a signer this package does not drive.
 */
export function transactionSignaturePreimage(
  networkHash: NetworkHash,
  tx: Transaction,
): Uint8Array {
  const prefix = TRANSACTION.bytes;
  const payload = serialize(tx, codec.Transaction);

  const preimage = new Uint8Array(
    prefix.length + networkHash.length + payload.length,
  );
  preimage.set(prefix, 0);
  preimage.set(networkHash, prefix.length);
  preimage.set(payload, prefix.length + networkHash.length);
  return preimage;
}
