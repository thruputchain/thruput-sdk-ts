import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  toBase58,
  fromBase58,
  fixedFromBase58,
  maxBase58Length,
  parseAddress,
  parsePublicKey,
  parseSecretSeed,
  addressToStrkey,
  publicKeyToStrkey,
  secretSeedToStrkey,
} from "./encoding.js";

describe("base58", () => {
  it("matches the shared protocol vectors (7336530)", () => {
    const vectors = JSON.parse(
      readFileSync(
        new URL("../fixtures/text-encoding.json", import.meta.url),
        "utf8",
      ),
    ) as {
      valid: {
        bytes: number[];
        base58: string;
        strkey?: { contract: string; publicKey: string; seed: string };
      }[];
      invalidBase58: string[];
      invalidStrkey: string[];
    };
    for (const vector of vectors.valid) {
      const bytes = Uint8Array.from(vector.bytes);
      expect(toBase58(bytes)).toBe(vector.base58);
      expect(fromBase58(vector.base58, bytes.length)).toEqual(bytes);
      if (vector.strkey) {
        expect(addressToStrkey(bytes)).toBe(vector.strkey.contract);
        expect(publicKeyToStrkey(bytes)).toBe(vector.strkey.publicKey);
        expect(secretSeedToStrkey(bytes)).toBe(vector.strkey.seed);
      }
    }
    for (const text of vectors.invalidBase58)
      expect(() => fromBase58(text, 256)).toThrow();
    for (const text of vectors.invalidStrkey)
      expect(() => parsePublicKey(text)).toThrow();
  });
  it("matches a published vector and preserves zero/empty bytes", () => {
    expect(toBase58(new TextEncoder().encode("Hello World"))).toBe(
      "JxF12TrwUP45BMd",
    );
    expect(fromBase58("JxF12TrwUP45BMd", 11)).toEqual(
      new TextEncoder().encode("Hello World"),
    );
    expect(toBase58(new Uint8Array(32))).toBe("1".repeat(32));
    expect(fixedFromBase58("1".repeat(32), 32)).toEqual(new Uint8Array(32));
    expect(toBase58(new Uint8Array())).toBe("");
    expect(fromBase58("", 0)).toEqual(new Uint8Array());
  });

  it("enforces encoded and decoded bounds without echoing input", () => {
    expect(maxBase58Length(32)).toBe(45);
    expect(maxBase58Length(0)).toBe(0);
    expect(maxBase58Length(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    for (const limit of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => fromBase58("", limit)).toThrow();
    }
    expect(() => fromBase58("1", 0)).toThrow();
    expect(() => fromBase58("1".repeat(33), 32)).toThrow();
    expect(() => fixedFromBase58("1".repeat(31), 32)).toThrow();
    expect(() => fromBase58("z".repeat(46), 32)).toThrow();
    for (const text of [
      "0",
      "O",
      "I",
      "l",
      " 1",
      "1 ",
      "1\n",
      "é",
      "１",
      "0x01",
    ]) {
      expect(() => fromBase58(text, 32)).toThrow("Invalid base58 encoding");
    }
    expect(fromBase58("ff", 2)).toEqual(Uint8Array.of(8, 194));
    expect(fromBase58("ab", 2)).not.toEqual(fromBase58("AB", 2));
  });
});

describe("typed Stellar input", () => {
  const c = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  const g = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const s = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSU2";

  it("preserves bytes and distinguishes addresses, keys, and seeds", () => {
    const bytes = new Uint8Array(32);
    expect(addressToStrkey(bytes)).toBe(c);
    expect(publicKeyToStrkey(bytes)).toBe(g);
    expect(secretSeedToStrkey(bytes)).toBe(s);
    expect(parseAddress(c)).toEqual(bytes);
    expect(parsePublicKey(g)).toEqual(bytes);
    expect(parseSecretSeed(s)).toEqual(bytes);
    expect(() => parseAddress(g)).toThrow();
    expect(() => parseAddress(s)).toThrow();
    expect(() => parsePublicKey(c)).toThrow();
    expect(() => parseSecretSeed(g)).toThrow();
    expect(() => parseSecretSeed(c)).toThrow();
    expect(() => parsePublicKey(g.toLowerCase())).toThrow();
    expect(() => parseAddress(c + "=")).toThrow();
    expect(() => parsePublicKey(g.slice(0, -1) + "G")).toThrow();
    for (const text of [c, g, s])
      expect(() => fixedFromBase58(text, 32)).toThrow();
    expect(() => parseSecretSeed("SECRET")).toThrow(
      "Expected a 32-byte base58 value or a valid S StrKey",
    );
  });

  it("accepts base58 regardless of its first letter", () => {
    for (let byte = 0; byte < 256; byte++) {
      const bytes = new Uint8Array(32).fill(byte);
      const text = toBase58(bytes);
      expect(parseAddress(text)).toEqual(bytes);
      expect(parsePublicKey(text)).toEqual(bytes);
      expect(parseSecretSeed(text)).toEqual(bytes);
    }
  });
});
