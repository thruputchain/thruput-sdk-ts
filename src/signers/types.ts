import type { Signature, PublicKey } from "@groundhogchain/protocol";

export interface Signer {
  sign(message: Uint8Array): Promise<Signature>;
  publicKey: PublicKey;
}
