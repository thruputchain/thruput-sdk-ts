import { describe, expect, it } from "vitest";
import type { Signer } from "./signers/index.js";
import {
  CryptographicScheme,
  ed25519PublicKey,
  ed25519Signature,
} from "@thruputchain/protocol";

describe("skeleton", () => {
  it("exports the Signer type", () => {
    const signer: Signer = {
      sign: async () => ({
        scheme: CryptographicScheme.Ed25519,
        ed25519: ed25519Signature(new Uint8Array(64)),
      }),
      publicKey: {
        scheme: CryptographicScheme.Ed25519,
        ed25519: ed25519PublicKey(new Uint8Array(32)),
      },
    };
    expect(signer.publicKey.ed25519.length).toBe(32);
  });
});
