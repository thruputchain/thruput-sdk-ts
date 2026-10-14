import { CryptographicScheme } from "@thruputchain/protocol";

/** XDR bytes of a `Signature` union value: discriminant plus padded opaque. */
const signatureBytes: Record<CryptographicScheme, number> = {
  [CryptographicScheme.Ed25519]: 4 + 64,
  // 3309 bytes, padded to a 4-byte boundary.
  [CryptographicScheme.MlDsa65]: 4 + 3312,
};

/** XDR bytes of a `PublicKey` union value: discriminant plus opaque. */
const publicKeyBytes: Record<CryptographicScheme, number> = {
  [CryptographicScheme.Ed25519]: 4 + 32,
  [CryptographicScheme.MlDsa65]: 4 + 1952,
};

/**
 * Bytes a `kPubkeySignature` signed envelope adds to the unsigned transaction:
 * the one-entry signature vector (count, key ID, signature) and the present
 * `pubkey_claim_key` option holding the key.
 *
 * Reserve this much when bounding an unsigned transaction against a
 * signed-transaction size limit: 116 bytes for Ed25519 and 5,284 bytes for
 * ML-DSA-65 (a 3,309-byte signature and a 1,952-byte key).
 */
export function pubkeySignatureEnvelopeBytes(
  scheme: CryptographicScheme,
): number {
  const signature = signatureBytes[scheme];
  const publicKey = publicKeyBytes[scheme];
  if (signature === undefined || publicKey === undefined) {
    throw new RangeError(`Unsupported cryptographic scheme: ${scheme}`);
  }
  // Vector count, public-key ID, signature, option flag, key.
  return 4 + 4 + signature + 4 + publicKey;
}
