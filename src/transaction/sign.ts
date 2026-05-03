import type {
  Transaction,
  SignedTransaction,
  DecoratedSignature,
} from "@groundhogchain/protocol";
import { serialize, codec } from "@groundhogchain/protocol";
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
      const signature = await entry.signer.sign(txBytes);
      return {
        public_key_id: entry.publicKeyId,
        signature,
      };
    }),
  );

  return { tx, signatures };
}
