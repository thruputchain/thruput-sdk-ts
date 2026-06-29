import type {
  Transaction,
  SignedTransaction,
  DecoratedSignature,
} from "@groundhogchain/protocol";
import { serialize, codec } from "@groundhogchain/protocol";
import type { Signer } from "../signers/types.js";

/** A signer plus the protocol public-key ID to attach to its signature. */
export interface SignerEntry {
  /** Signer implementation that produces a protocol signature. */
  signer: Signer;

  /** Public-key ID expected by the chain for this signer. */
  publicKeyId: bigint;
}

/**
 * Sign a transaction with one or more signers.
 *
 * The transaction is serialized once and each signer signs the same canonical
 * bytes. The result can be passed to `sendTransaction` or serialized with
 * `serializeSignedTransaction`.
 *
 * @example
 * ```ts
 * import { signTransaction } from "@groundhogchain/client/transaction";
 * import { PrivateKeySigner } from "@groundhogchain/client/signers";
 *
 * const signer = new PrivateKeySigner(secretKey);
 * const signedTx = await signTransaction(tx, [
 *   { signer, publicKeyId: 0n },
 * ]);
 * ```
 */
export async function signTransaction(
  tx: Transaction,
  signers: SignerEntry[],
): Promise<SignedTransaction> {
  const txBytes = serialize(tx, codec.Transaction);

  const signatures: DecoratedSignature[] = await Promise.all(
    signers.map(async (entry) => {
      const signature = await entry.signer.sign(txBytes);
      return {
        public_key_id: entry.publicKeyId,
        signature,
      };
    }),
  );

  return { tx, signatures };
}
