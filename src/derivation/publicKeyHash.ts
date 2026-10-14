import { codec, publicKeyHash } from "@thruputchain/protocol";
import type { PublicKey, PublicKeyHash } from "@thruputchain/protocol";
import { PUBLIC_KEY } from "./domainSeparator.js";

/**
 * Hashes a public key, scheme included:
 * `sha256( cxs(DomainSeparator("PublicKey")) || cxs(pubkey) )`.
 *
 * A pubkey account names its key by this hash, so an Ed25519 key and an
 * ML-DSA-65 key can never share an account even if their bytes overlap. The
 * signed envelope carries the key itself as `pubkey_claim_key`, which the chain
 * checks against this hash.
 *
 * @example
 * ```ts
 * import { derivePublicKeyHash } from "@thruputchain/client";
 *
 * const hash = derivePublicKeyHash(signer.publicKey);
 * ```
 */
export function derivePublicKeyHash(pubkey: PublicKey): PublicKeyHash {
  return publicKeyHash(PUBLIC_KEY.hashObject(pubkey, codec.PublicKey));
}
