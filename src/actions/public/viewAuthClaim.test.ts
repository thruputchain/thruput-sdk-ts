import { describe, expect, it } from "vitest";
import {
  AuthClaimType,
  bitMap,
  weight,
  publicKeyHash,
} from "@thruputchain/protocol";
import { toAssumedAuth } from "../viewAuthClaim.js";
import { encodeRequest } from "../../rpc/codec.js";
import { toBase58 } from "../../encoding.js";
const address = new Uint8Array(32),
  entrypoint = new Uint8Array(8),
  calldata = new Uint8Array();
describe("native assumed authorization", () => {
  it("maps source-address authorization into the typed request", () => {
    expect(
      toAssumedAuth({
        claim_type: AuthClaimType.kSourceAddressAuthData,
        source_address_claim: {
          allowed_keys: bitMap(5n),
          required_weight: weight(3n),
        },
      }),
    ).toEqual({ kind: "sourceAddress", allowedKeys: 5, requiredWeight: 3 });
  });
  it("preserves full-width pubkey nonce and snapshots bytes", () => {
    const key = publicKeyHash(new Uint8Array(32).fill(7));
    const auth = toAssumedAuth({
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: { pubkey_hash: key, nonce: 9007199254740993n },
    });
    key.fill(0);
    expect(
      encodeRequest("simulateInvocation", {
        address,
        entrypoint,
        calldata,
        assumedAuth: auth,
      }),
    ).toMatchObject({
      assumedAuth: {
        kind: "pubkeySignature",
        pubkeyHash: toBase58(new Uint8Array(32).fill(7)),
        accountNonce: "9007199254740993",
      },
    });
  });
  it.each([-1n, 1n << 64n])("rejects nonce outside u64", (nonce) => {
    expect(() =>
      toAssumedAuth({
        claim_type: AuthClaimType.kPubkeySignature,
        pubkey_preimage: { pubkey_hash: publicKeyHash(address), nonce },
      }),
    ).toThrow();
  });
});
