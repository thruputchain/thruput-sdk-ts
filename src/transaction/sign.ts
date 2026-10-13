import type {
  Transaction,
  SignedTransaction,
  DecoratedSignature,
  NetworkHash,
} from "@thruputchain/protocol";
import {
  AuthClaimType,
  codec,
  deserialize,
  kMaxSigners,
  serialize,
} from "@thruputchain/protocol";
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
 * read it from the public `getNetworkInfo` response; elsewhere it
 * comes from whoever operates the network.
 *
 * @example
 * ```ts
 * import { signTransaction } from "@thruputchain/client/transaction";
 * import { PrivateKeySigner } from "@thruputchain/client/signers";
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
  validateSignerEntries(transaction, signerEntries);
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

function validateSignerEntries(
  transaction: Transaction,
  signers: readonly SignerEntry[],
): void {
  if (signers.length > kMaxSigners) {
    throw new RangeError(`signers must contain at most ${kMaxSigners} entries`);
  }

  let previousId = -1n;
  for (const entry of signers) {
    if (
      typeof entry.publicKeyId !== "bigint" ||
      entry.publicKeyId < 0n ||
      entry.publicKeyId >= kMaxSigners
    ) {
      throw new RangeError(
        `publicKeyId must be between 0 and ${kMaxSigners - 1n}`,
      );
    }
    if (entry.publicKeyId <= previousId) {
      throw new Error("Signer publicKeyIds must be strictly increasing");
    }
    if (!entry.signer || typeof entry.signer.sign !== "function") {
      throw new Error("Invalid signer");
    }
    previousId = entry.publicKeyId;
  }

  if (transaction.auth_claim.claim_type === AuthClaimType.kPubkeySignature) {
    if (signers.length !== 1 || signers[0]!.publicKeyId !== 0n) {
      throw new Error("Pubkey authorization requires only publicKeyId 0");
    }
    return;
  }

  const allowedKeys = transaction.auth_claim.source_address_claim.allowed_keys;
  for (const { publicKeyId } of signers) {
    if ((allowedKeys & (1n << publicKeyId)) === 0n) {
      throw new Error(
        `publicKeyId ${publicKeyId} is not selected by authClaim`,
      );
    }
  }
}
