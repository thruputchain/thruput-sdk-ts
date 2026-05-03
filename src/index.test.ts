import { describe, expect, it } from "vitest";
import type { Signer } from "./signers/index.js";
import { ed25519PublicKey } from "@groundhogchain/protocol";

describe("skeleton", () => {
  it("exports the Signer type", () => {
    const signer: Signer = {
      sign: async (msg) => msg,
      publicKey: ed25519PublicKey(new Uint8Array(32)),
    };
    expect(signer.publicKey.length).toBe(32);
  });
});
