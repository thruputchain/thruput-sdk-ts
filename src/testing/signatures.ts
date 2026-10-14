import { CryptographicScheme } from "@thruputchain/protocol";
import type {
  Ed25519Signature,
  MlDsa65Signature,
  Signature,
} from "@thruputchain/protocol";

/** Test helper: the bytes of an Ed25519 signature, failing on any other scheme. */
export function ed25519Of(signature: Signature): Ed25519Signature {
  if (signature.scheme !== CryptographicScheme.Ed25519) {
    throw new Error("expected an Ed25519 signature");
  }
  return signature.ed25519;
}

/** Test helper: the bytes of an ML-DSA-65 signature, failing on any other scheme. */
export function mlDsa65Of(signature: Signature): MlDsa65Signature {
  if (signature.scheme !== CryptographicScheme.MlDsa65) {
    throw new Error("expected an ML-DSA-65 signature");
  }
  return signature.mldsa65;
}
