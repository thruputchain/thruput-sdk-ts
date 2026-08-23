import {
  AuthClaimType,
  bitMap,
  contractAddress,
  weight,
} from "@groundhogchain/protocol";
import { describe, expect, it } from "vitest";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { derivePubkeyAccountAddress } from "../derivation/pubkeyAccount.js";
import { createPubkeyAccount, createSourceAddressAccount } from "./account.js";

function signer(seed: number): PrivateKeySigner {
  const secret = new Uint8Array(32);
  secret[0] = seed;
  return new PrivateKeySigner(secret);
}

describe("createPubkeyAccount", () => {
  it("derives the canonical address and pubkey auth claim", () => {
    const accountSigner = signer(1);
    const account = createPubkeyAccount({ signer: accountSigner, nonce: 7n });

    expect(account.kind).toBe("pubkey");
    expect(account.address).toEqual(
      derivePubkeyAccountAddress({
        pubkey: accountSigner.publicKey,
        nonce: 7n,
      }),
    );
    expect(account.authClaim).toEqual({
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: { pubkey: accountSigner.publicKey, nonce: 7n },
    });
    expect(account.signers).toEqual([
      { signer: accountSigner, publicKeyId: 0n },
    ]);
  });

  it.each([-1n, 0x1_0000_0000_0000_0000n])(
    "rejects out-of-range nonce %s",
    (nonce) => {
      expect(() => createPubkeyAccount({ signer: signer(2), nonce })).toThrow(
        "nonce must be between",
      );
    },
  );
});

describe("createSourceAddressAccount", () => {
  it("builds source-address auth and copies mutable inputs", () => {
    const address = contractAddress(new Uint8Array(32).fill(0x11));
    const accountSigner = signer(3);
    const signers = [{ signer: accountSigner, publicKeyId: 0n }];
    const account = createSourceAddressAccount({
      address,
      signers,
      allowedKeys: bitMap(1n),
      requiredWeight: weight(1n),
    });

    address.fill(0x22);
    signers[0]!.publicKeyId = 1n;

    expect(account.kind).toBe("sourceAddress");
    expect(account.address).toEqual(new Uint8Array(32).fill(0x11));
    expect(account.authClaim).toEqual({
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(1n),
        required_weight: weight(1n),
      },
    });
    expect(account.signers[0]!.publicKeyId).toBe(0n);
  });

  it("supports multiple distinct selected key IDs", () => {
    const account = createSourceAddressAccount({
      address: contractAddress(new Uint8Array(32)),
      signers: [
        { signer: signer(5), publicKeyId: 2n },
        { signer: signer(4), publicKeyId: 0n },
      ],
      allowedKeys: bitMap(0b101n),
      requiredWeight: weight(2n),
    });

    expect(account.signers.map(({ publicKeyId }) => publicKeyId)).toEqual([
      0n,
      2n,
    ]);
  });

  it("accepts zero claimed weight without lowering on-chain policy", () => {
    const account = createSourceAddressAccount({
      address: contractAddress(new Uint8Array(32)),
      signers: [{ signer: signer(6), publicKeyId: 0n }],
      allowedKeys: bitMap(1n),
      requiredWeight: weight(0n),
    });

    expect(account.authClaim.source_address_claim.required_weight).toBe(0n);
  });

  it.each([
    {
      label: "empty signer list",
      signers: [],
      allowedKeys: bitMap(1n),
      requiredWeight: weight(1n),
    },
    {
      label: "empty bitmap",
      signers: [{ signer: signer(6), publicKeyId: 0n }],
      allowedKeys: bitMap(0n),
      requiredWeight: weight(1n),
    },
    {
      label: "unselected signer",
      signers: [{ signer: signer(7), publicKeyId: 1n }],
      allowedKeys: bitMap(1n),
      requiredWeight: weight(1n),
    },
    {
      label: "duplicate signer IDs",
      signers: [
        { signer: signer(8), publicKeyId: 0n },
        { signer: signer(9), publicKeyId: 0n },
      ],
      allowedKeys: bitMap(1n),
      requiredWeight: weight(1n),
    },
  ])("rejects $label", ({ signers, allowedKeys, requiredWeight }) => {
    expect(() =>
      createSourceAddressAccount({
        address: contractAddress(new Uint8Array(32)),
        signers,
        allowedKeys,
        requiredWeight,
      }),
    ).toThrow();
  });

  it("rejects malformed signer entries", () => {
    expect(() =>
      createSourceAddressAccount({
        address: contractAddress(new Uint8Array(32)),
        signers: [{ signer: undefined as never, publicKeyId: 0n }],
        allowedKeys: bitMap(1n),
        requiredWeight: weight(1n),
      }),
    ).toThrow("Invalid signer");
  });
});
