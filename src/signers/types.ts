import type { Ed25519PublicKey } from "@groundhogchain/protocol";

export interface Signer {
  sign(message: Uint8Array): Promise<Uint8Array>;
  publicKey: Ed25519PublicKey;
}
