import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { toHex } from "@groundhogchain/protocol";
import type { ContractAddress, NetworkHash } from "@groundhogchain/protocol";
import {
  encodeSignedOperation,
  signedOperationId,
  signedOperationPreimage,
  type SignedOperation,
} from "./preimage.js";
import { operationTypeId } from "../derivation/entrypointId.js";

const base: SignedOperation = {
  network: new Uint8Array(32).fill(0x5a) as NetworkHash,
  verifyingContract: new Uint8Array(32).fill(0x03) as ContractAddress,
  typeId: 0xaaaaaaaaaaaaaaaan,
  nonce: 1n,
  validUntil: 1000n,
  body: new Uint8Array([0x2a]),
};

describe("signed operation encoding", () => {
  it("lays out the fixed prefix as network, contract, type ID", () => {
    const encoded = encodeSignedOperation(base);
    expect(encoded.slice(0, 32)).toEqual(new Uint8Array(32).fill(0x5a));
    expect(encoded.slice(32, 64)).toEqual(new Uint8Array(32).fill(0x03));
    expect(toHex(encoded.slice(64, 72))).toBe("aaaaaaaaaaaaaaaa");
  });

  it("prefixes the preimage with the versioned SignedOp separator", () => {
    const preimage = signedOperationPreimage(base);
    // 0x00 (ext) + 0x0b (len 11) + "SignedOp::1"
    expect(toHex(preimage.slice(0, 13))).toBe("000b5369676e65644f703a3a31");
    expect(preimage.slice(13)).toEqual(encodeSignedOperation(base));
  });

  it("derives the identifier as sha256 of the signed bytes", () => {
    expect(toHex(signedOperationId(base))).toBe(
      toHex(sha256(signedOperationPreimage(base))),
    );
  });

  it.each([
    ["network", { network: new Uint8Array(32).fill(0xa5) as NetworkHash }],
    [
      "verifyingContract",
      { verifyingContract: new Uint8Array(32).fill(0x04) as ContractAddress },
    ],
    ["typeId", { typeId: 0xbbbbbbbbbbbbbbbbn }],
    ["nonce", { nonce: 2n }],
    ["validUntil", { validUntil: 1001n }],
    ["body", { body: new Uint8Array([0x2b]) }],
  ] as const)("changing %s changes the message", (_field, patch) => {
    expect(toHex(signedOperationPreimage({ ...base, ...patch }))).not.toBe(
      toHex(signedOperationPreimage(base)),
    );
  });

  it("rejects a network hash that is not 32 bytes", () => {
    expect(() =>
      encodeSignedOperation({
        ...base,
        network: new Uint8Array(31) as NetworkHash,
      }),
    ).toThrow(/network must be 32 bytes/);
  });

  it("rejects a type ID that does not fit in a u64", () => {
    expect(() =>
      encodeSignedOperation({ ...base, typeId: 2n ** 64n }),
    ).toThrow(/typeId must fit in a u64/);
  });

  /// Two operations whose bodies encode identically must still differ, or the
  /// type binding is not doing anything.
  it("separates identically encoded bodies by type ID", () => {
    const grant = operationTypeId("MyWallet", "0.1.0", "grant");
    const revoke = operationTypeId("MyWallet", "0.1.0", "revoke");
    expect(grant).not.toBe(revoke);
    expect(toHex(signedOperationPreimage({ ...base, typeId: grant }))).not.toBe(
      toHex(signedOperationPreimage({ ...base, typeId: revoke })),
    );
  });
});
