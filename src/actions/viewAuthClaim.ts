import {
  AuthClaimType,
  codec,
  deserialize,
  serialize,
  type AuthClaim,
} from "@thruputchain/protocol";
import { serializeU64 } from "./decimal.js";

function u32(value: bigint, name: string): number {
  serializeU64(value, name);
  if (value > 0xffff_ffffn) throw new RangeError(`${name} must fit uint32`);
  return Number(value);
}

/** Encode only public authorization data; this does not sign or verify anything. */
export function serializeViewAuthClaim(claim: AuthClaim) {
  switch (claim.claim_type) {
    case AuthClaimType.kSourceAddressAuthData:
      return {
        kind: "sourceAddress" as const,
        allowedKeys: u32(
          claim.source_address_claim.allowed_keys,
          "allowedKeys",
        ),
        requiredWeight: u32(
          claim.source_address_claim.required_weight,
          "requiredWeight",
        ),
      };
    case AuthClaimType.kPubkeySignature:
      // The claim names its key only by hash, but the view RPC's
      // `pubkeySignature` form still takes the Ed25519 key itself.
      throw new TypeError(
        "View authClaim does not yet support kPubkeySignature claims: the claim names its key by hash and the view RPC takes the key",
      );
    default:
      throw new TypeError("Unsupported view authClaim type");
  }
}

/** Snapshot a prepared call's claim using the canonical protocol codec. */
export function copyViewAuthClaim(claim: AuthClaim): AuthClaim {
  serializeViewAuthClaim(claim);
  return deserialize(serialize(claim, codec.AuthClaim), codec.AuthClaim);
}
