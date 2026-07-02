import type { Signature, PublicKey } from "@groundhogchain/protocol";

/**
 * Interface for signing canonical transaction bytes.
 *
 * Implement this interface to connect the SDK to a wallet, hardware signer,
 * remote signer, or custom key-management system.
 */
export interface Signer {
  /** Sign an arbitrary byte message and return a protocol signature. */
  sign(message: Uint8Array): Promise<Signature>;

  /** Public key corresponding to signatures produced by this signer. */
  publicKey: PublicKey;
}
