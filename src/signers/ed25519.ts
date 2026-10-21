import { sha512 } from "@noble/hashes/sha2.js";
import { hashes, sign, getPublicKey } from "@noble/ed25519";
import type { Signature, PublicKey } from "@thruputchain/protocol";
import {
  CryptographicScheme,
  ed25519PublicKey,
  ed25519Signature,
} from "@thruputchain/protocol";
import type { Signer } from "./types.js";

if (!hashes.sha512) {
  hashes.sha512 = sha512;
}

/** Length of an Ed25519 private key (the RFC 8032 seed). */
const SEED_BYTES = 32;

/**
 * Ed25519 signer backed by an in-memory private key.
 *
 * This is convenient for scripts and tests. Browser wallets or production key
 * management systems should usually provide their own {@link Signer}
 * implementation instead of exposing raw private keys to application code.
 *
 * @example
 * ```ts
 * import { Ed25519Signer } from "@thruputchain/client/signers";
 *
 * const signer = Ed25519Signer.fromSeed(seed); // 32 bytes
 * const signature = await signer.sign(message);
 * ```
 */
export class Ed25519Signer implements Signer {
  /** Ed25519 public key derived from the constructor's private key. */
  publicKey: Extract<PublicKey, { scheme: CryptographicScheme.Ed25519 }>;
  #secretKey: Uint8Array;

  /**
   * Create an Ed25519 signer from a 32-byte private key.
   *
   * Prefer {@link Ed25519Signer.fromSeed}, which validates the key length and
   * matches `MlDsa65Signer.fromSeed`.
   */
  constructor(secretKey: Uint8Array) {
    this.#secretKey = secretKey;
    this.publicKey = {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519PublicKey(new Uint8Array(getPublicKey(secretKey))),
    };
  }

  /** Create an Ed25519 signer from a 32-byte RFC 8032 private key seed. */
  static fromSeed(seed: Uint8Array): Ed25519Signer {
    if (!(seed instanceof Uint8Array) || seed.length !== SEED_BYTES) {
      throw new RangeError(`Ed25519 seed must be ${SEED_BYTES} bytes`);
    }
    return new Ed25519Signer(new Uint8Array(seed));
  }

  /** Sign a message with the in-memory Ed25519 private key. */
  async sign(
    message: Uint8Array,
  ): Promise<Extract<Signature, { scheme: CryptographicScheme.Ed25519 }>> {
    return {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519Signature(new Uint8Array(sign(message, this.#secretKey))),
    };
  }
}
