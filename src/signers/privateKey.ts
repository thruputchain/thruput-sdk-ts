import { sha512 } from "@noble/hashes/sha2.js";
import { hashes, sign, getPublicKey } from "@noble/ed25519";
import type { Signature, PublicKey } from "@groundhogchain/protocol";
import {
  CryptographicScheme,
  ed25519PublicKey,
  ed25519Signature,
} from "@groundhogchain/protocol";
import type { Signer } from "./types.js";

if (!hashes.sha512) {
  hashes.sha512 = sha512;
}

export class PrivateKeySigner implements Signer {
  publicKey: PublicKey;
  #secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.#secretKey = secretKey;
    this.publicKey = {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519PublicKey(new Uint8Array(getPublicKey(secretKey))),
    };
  }

  async sign(message: Uint8Array): Promise<Signature> {
    return {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519Signature(new Uint8Array(sign(message, this.#secretKey))),
    };
  }
}
