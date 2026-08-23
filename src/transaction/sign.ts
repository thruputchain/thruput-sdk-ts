import type {
  Transaction,
  SignedTransaction,
  DecoratedSignature,
  NetworkHash,
} from "@groundhogchain/protocol";
import { deserialize, serialize, codec } from "@groundhogchain/protocol";
import type { Signer } from "../signers/types.js";
import { transactionSignaturePreimage } from "./preimage.js";

/** A signer plus the protocol public-key ID to attach to its signature. */
export interface SignerEntry {
  /** Signer implementation that produces a protocol signature. */
  readonly signer: Signer;

  /** Public-key ID expected by the chain for this signer. */
  readonly publicKeyId: bigint;
}

/**
 * Sign a transaction with one or more signers.
 *
 * The signature preimage is built once and each signer signs the same canonical
 * bytes. The result can be passed to `sendTransaction` or serialized with
 * `serializeSignedTransaction`.
 *
 * `networkHash` identifies the network the transaction is for. It is part of
 * what gets signed, so a transaction signed for one chain will be rejected by
 * another — see {@link transactionSignaturePreimage}. Local development can
 * read it from the runtime manifest via `loadLocalDevAccount`; elsewhere it
 * comes from whoever operates the network.
 *
 * @example
 * ```ts
 * import { signTransaction } from "@groundhogchain/client/transaction";
 * import { PrivateKeySigner } from "@groundhogchain/client/signers";
 *
 * const signer = new PrivateKeySigner(secretKey);
 * const signedTx = await signTransaction(
 *   tx,
 *   [{ signer, publicKeyId: 0n }],
 *   networkHash,
 * );
 * ```
 */
export async function signTransaction(
  tx: Transaction,
  signers: readonly SignerEntry[],
  networkHash: NetworkHash,
): Promise<SignedTransaction> {
  const txBytes = serialize(tx, codec.Transaction);
  const transaction = deserialize(txBytes, codec.Transaction);
  const signerEntries = signers.map(({ signer, publicKeyId }) => ({
    signer,
    publicKeyId,
  }));
  const preimage = transactionSignaturePreimage(networkHash, transaction);

  const signatures: DecoratedSignature[] = await Promise.all(
    signerEntries.map(async (entry) => {
      const signature = await entry.signer.sign(preimage);
      return {
        public_key_id: entry.publicKeyId,
        signature,
      };
    }),
  );

  return { tx: transaction, signatures };
}
