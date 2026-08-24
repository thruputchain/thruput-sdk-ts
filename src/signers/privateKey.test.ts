import { describe, expect, it } from "vitest";
import { CryptographicScheme } from "@groundhogchain/protocol";
import { fromHex0x } from "../actions/hex.js";
import { PrivateKeySigner } from "./privateKey.js";

// RFC 8032 section 7.1, Ed25519 test vector 1 (empty message).
const RFC8032_SEED =
  "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC8032_PUBLIC_KEY =
  "0xd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC8032_SIGNATURE =
  "0xe5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

describe("PrivateKeySigner", () => {
  it("rejects secret keys that are not exactly 32 bytes", () => {
    for (const length of [0, 16, 31, 33, 64]) {
      expect(() => new PrivateKeySigner(new Uint8Array(length))).toThrow(
        RangeError,
      );
      expect(() => new PrivateKeySigner(new Uint8Array(length))).toThrow(
        /32 bytes/,
      );
    }
  });

  it("is isolated from later mutation of the caller's key buffer", async () => {
    const seed = fromHex0x(RFC8032_SEED);
    const signer = new PrivateKeySigner(seed);
    const publicKeyBefore = new Uint8Array(signer.publicKey.ed25519!);

    seed.fill(0xff);

    expect(new Uint8Array(signer.publicKey.ed25519!)).toEqual(publicKeyBefore);
    const signature = await signer.sign(new Uint8Array(0));
    expect(new Uint8Array(signature.ed25519!)).toEqual(
      fromHex0x(RFC8032_SIGNATURE),
    );
  });

  it("matches the RFC 8032 Ed25519 known-answer vector", async () => {
    const signer = new PrivateKeySigner(fromHex0x(RFC8032_SEED));

    expect(signer.publicKey.scheme).toBe(CryptographicScheme.Ed25519);
    expect(new Uint8Array(signer.publicKey.ed25519!)).toEqual(
      fromHex0x(RFC8032_PUBLIC_KEY),
    );

    const signature = await signer.sign(new Uint8Array(0));
    expect(signature.scheme).toBe(CryptographicScheme.Ed25519);
    expect(new Uint8Array(signature.ed25519!)).toEqual(
      fromHex0x(RFC8032_SIGNATURE),
    );
  });
});
