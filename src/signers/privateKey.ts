import { sha512 } from "@noble/hashes/sha2.js";
import { hashes, sign, getPublicKey } from "@noble/ed25519";
import type { Ed25519PublicKey } from "@groundhogchain/protocol";
import { ed25519PublicKey } from "@groundhogchain/protocol";
import type { Signer } from "./types.js";

hashes.sha512 = sha512;

export class PrivateKeySigner implements Signer {
  publicKey: Ed25519PublicKey;
  private secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey;
    this.publicKey = ed25519PublicKey(new Uint8Array(getPublicKey(secretKey)));
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(sign(message, this.secretKey));
  }
}
