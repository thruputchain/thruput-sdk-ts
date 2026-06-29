import { sha512 } from "@noble/hashes/sha2.js";
import { hashes, sign, getPublicKey } from "@noble/ed25519";
import type { Signature, PublicKey } from "@groundhogchain/protocol";
import {
  CryptographicScheme,
  ed25519PublicKey,
  ed25519Signature,
} from "@groundhogchain/protocol";
import type { Signer } from "./types.js";

if (!hashes.sha512) {
  hashes.sha512 = sha512;
}

/**
 * Ed25519 signer backed by an in-memory private key.
 *
 * This is convenient for scripts and tests. Browser wallets or production key
 * management systems should usually provide their own {@link Signer}
 * implementation instead of exposing raw private keys to application code.
 *
 * @example
 * ```ts
 * import { PrivateKeySigner } from "@groundhogchain/client/signers";
 *
 * const signer = new PrivateKeySigner(secretKey);
 * const signature = await signer.sign(message);
 * ```
 */
export class PrivateKeySigner implements Signer {
  /** Public key derived from the constructor's private key. */
  publicKey: PublicKey;
  #secretKey: Uint8Array;

  /** Create an Ed25519 signer from a 32-byte private key. */
  constructor(secretKey: Uint8Array) {
    this.#secretKey = secretKey;
    this.publicKey = {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519PublicKey(new Uint8Array(getPublicKey(secretKey))),
    };
  }

  /** Sign a message with the in-memory Ed25519 private key. */
  async sign(message: Uint8Array): Promise<Signature> {
    return {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519Signature(new Uint8Array(sign(message, this.#secretKey))),
    };
  }
}
