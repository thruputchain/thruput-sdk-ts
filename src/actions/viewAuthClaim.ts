import { AuthClaimType, type AuthClaim } from "@thruputchain/protocol";
import type { RpcAssumedAuth } from "../rpc/generated.js";
import { serializeU64 } from "./decimal.js";
function u32(value: bigint, name: string): number {
  serializeU64(value, name);
  if (value > 0xffffffffn) throw new RangeError(`${name} must fit uint32`);
  return Number(value);
}
/** Project public authorization assumptions; this neither signs nor verifies authorization. */
export function toAssumedAuth(claim: AuthClaim): RpcAssumedAuth {
  switch (claim.claim_type) {
    case AuthClaimType.kSourceAddressAuthData:
      return {
        kind: "sourceAddress",
        allowedKeys: u32(
          claim.source_address_claim.allowed_keys,
          "allowedKeys",
        ),
        requiredWeight: u32(
          claim.source_address_claim.required_weight,
          "requiredWeight",
        ),
      };
    case AuthClaimType.kPubkeySignature: {
      const { pubkey_hash, nonce } = claim.pubkey_preimage;
      if (!(pubkey_hash instanceof Uint8Array) || pubkey_hash.length !== 32)
        throw new TypeError("Assumed pubkey hash must contain 32 bytes");
      serializeU64(nonce, "accountNonce");
      return {
        kind: "pubkeySignature",
        pubkeyHash: pubkey_hash.slice(),
        accountNonce: nonce,
      };
    }
    default:
      throw new TypeError("Unsupported authorization assumption");
  }
}
