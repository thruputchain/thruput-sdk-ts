import type {
  Transaction,
  SignedTransaction,
  DecoratedSignature,
} from "@groundhogchain/protocol";
import {
  serialize,
  codec,
  CryptographicScheme,
  ed25519Signature,
} from "@groundhogchain/protocol";
import type { Signer } from "../signers/types.js";

export interface SignerEntry {
  signer: Signer;
  publicKeyId: bigint;
}

export async function signTransaction(
  tx: Transaction,
  signers: SignerEntry[],
): Promise<SignedTransaction> {
  const txBytes = serialize(tx, codec.Transaction);

  const signatures: DecoratedSignature[] = await Promise.all(
    signers.map(async (entry) => {
      const sig = await entry.signer.sign(txBytes);
      return {
        public_key_id: entry.publicKeyId,
        signature: {
          scheme: CryptographicScheme.Ed25519,
          ed25519: ed25519Signature(new Uint8Array(sig)),
        },
      };
    }),
  );

  return { tx, signatures };
}
