import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import type {
  MlDsa65PublicKey,
  MlDsa65Signature,
  PublicKey,
  Signature,
} from "@thruputchain/protocol";
import {
  CryptographicScheme,
  mlDsa65PublicKey,
  mlDsa65Signature,
} from "@thruputchain/protocol";
import type { Signer } from "./types.js";

/** Length of the FIPS 204 key-generation seed `ξ`. */
const SEED_BYTES = 32;

/**
 * ML-DSA-65 (FIPS 204) signer backed by an in-memory key derived from a seed.
 *
 * Signatures are pure ML-DSA (not HashML-DSA) with an empty context string,
 * over the same transaction signature preimage an Ed25519 signer signs. Keys
 * are scheme-tagged {@link PublicKey} values; there is no StrKey form for them.
 *
 * Signing is hedged by default (fresh randomness mixed into each signature).
 * Pass `{ deterministic: true }` for the FIPS 204 deterministic variant, which
 * reproduces the same signature for the same key and message.
 *
 * @example
 * ```ts
 * import { MlDsa65Signer } from "@thruputchain/client/signers";
 *
 * const signer = MlDsa65Signer.fromSeed(seed); // 32 bytes
 * const signature = await signer.sign(message);
 * ```
 */
export class MlDsa65Signer implements Signer {
  /** Scheme-tagged ML-DSA-65 public key derived from the seed. */
  readonly publicKey: Extract<
    PublicKey,
    { scheme: CryptographicScheme.MlDsa65 }
  >;
  readonly #secretKey: Uint8Array;
  readonly #deterministic: boolean;

  private constructor(
    publicKey: MlDsa65PublicKey,
    secretKey: Uint8Array,
    deterministic: boolean,
  ) {
    this.publicKey = {
      scheme: CryptographicScheme.MlDsa65,
      mldsa65: publicKey,
    };
    this.#secretKey = secretKey;
    this.#deterministic = deterministic;
  }

  /** Derive an ML-DSA-65 key pair from a 32-byte FIPS 204 `ξ` seed. */
  static fromSeed(
    seed: Uint8Array,
    options: { readonly deterministic?: boolean } = {},
  ): MlDsa65Signer {
    if (!(seed instanceof Uint8Array) || seed.length !== SEED_BYTES) {
      throw new RangeError(`ML-DSA-65 seed must be ${SEED_BYTES} bytes`);
    }
    const { publicKey, secretKey } = ml_dsa65.keygen(new Uint8Array(seed));
    return new MlDsa65Signer(
      mlDsa65PublicKey(new Uint8Array(publicKey)),
      new Uint8Array(secretKey),
      options.deterministic ?? false,
    );
  }

  /** Sign a message with pure ML-DSA-65 and an empty context. */
  async sign(message: Uint8Array): Promise<Signature> {
    const signature = ml_dsa65.sign(
      message,
      this.#secretKey,
      this.#deterministic ? { extraEntropy: false } : {},
    );
    return {
      scheme: CryptographicScheme.MlDsa65,
      mldsa65: mlDsa65Signature(new Uint8Array(signature)),
    };
  }
}

/**
 * Verify a pure ML-DSA-65 signature with an empty context string.
 *
 * Returns `false` for a malformed or invalid signature rather than throwing.
 */
export function verifyMlDsa65(
  publicKey: MlDsa65PublicKey,
  message: Uint8Array,
  signature: MlDsa65Signature,
): boolean {
  try {
    return ml_dsa65.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
