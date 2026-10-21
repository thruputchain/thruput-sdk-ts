import type {
  Transaction,
  SignedTransaction,
  DecoratedSignature,
  NetworkHash,
  PublicKey,
} from "@thruputchain/protocol";
import {
  AuthClaimType,
  codec,
  deserialize,
  kMaxSigners,
  serialize,
} from "@thruputchain/protocol";
import type { Signer } from "../signers/types.js";
import { derivePublicKeyHash } from "../derivation/publicKeyHash.js";
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
 * For a `kPubkeySignature` claim there must be exactly one signer, with
 * public-key ID zero, whose key hashes to the claim's `pubkey_hash`; its key is
 * attached as `pubkey_claim_key` and its signature must use the key's scheme.
 * Other claims carry no `pubkey_claim_key`. Neither the key nor the signatures
 * are part of the signed `Transaction`, so re-signing never changes the
 * transaction hash.
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
 * import { Ed25519Signer } from "@thruputchain/client/signers";
 *
 * const signer = Ed25519Signer.fromSeed(secretKey);
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
  const pubkeyClaimKey = validateSignerEntries(transaction, signerEntries);
  const preimage = transactionSignaturePreimage(networkHash, transaction);

  const signatures: DecoratedSignature[] = await Promise.all(
    signerEntries.map(async (entry) => {
      const signature = await entry.signer.sign(preimage);
      if (pubkeyClaimKey && signature.scheme !== pubkeyClaimKey.scheme) {
        throw new Error(
          "Signer returned a signature whose scheme does not match its public key",
        );
      }
      return {
        public_key_id: entry.publicKeyId,
        signature,
      };
    }),
  );

  return { tx: transaction, signatures, pubkey_claim_key: pubkeyClaimKey };
}

/** Validates the signer set and returns the key a pubkey claim must carry. */
function validateSignerEntries(
  transaction: Transaction,
  signers: readonly SignerEntry[],
): PublicKey | null {
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
    const publicKey = copyPublicKey(signers[0]!.signer.publicKey);
    if (
      !bytesEqual(
        derivePublicKeyHash(publicKey),
        transaction.auth_claim.pubkey_preimage.pubkey_hash,
      )
    ) {
      throw new Error(
        "Signer public key does not match the auth claim's pubkey_hash",
      );
    }
    return publicKey;
  }

  const allowedKeys = transaction.auth_claim.source_address_claim.allowed_keys;
  for (const { publicKeyId } of signers) {
    if ((allowedKeys & (1n << publicKeyId)) === 0n) {
      throw new Error(
        `publicKeyId ${publicKeyId} is not selected by authClaim`,
      );
    }
  }
  return null;
}

/** Copy and re-validate a signer's key through the protocol codec. */
function copyPublicKey(publicKey: PublicKey): PublicKey {
  try {
    return deserialize(serialize(publicKey, codec.PublicKey), codec.PublicKey);
  } catch {
    throw new Error("Invalid signer public key");
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}
