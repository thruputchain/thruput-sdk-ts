import { describe, expect, it } from "vitest";
import type { Signer } from "./signers/index.js";

describe("skeleton", () => {
  it("exports the Signer type", () => {
    const signer: Signer = {
      sign: async (msg) => msg,
      publicKey: () => new Uint8Array(32),
    };
    expect(signer.publicKey().length).toBe(32);
  });
});
