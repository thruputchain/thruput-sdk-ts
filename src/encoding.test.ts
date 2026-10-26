import { describe, expect, it } from "vitest";
import {
  toBase58,
  fixedFromBase58,
  addressFromBase58,
  hashFromBase58,
  parseAddress,
  parsePublicKey,
  parseSecretSeed,
  addressToStrkey,
  publicKeyToStrkey,
  secretSeedToStrkey,
} from "./encoding.js";

describe("identifier adapters", () => {
  it("requires base58 identifiers of the exact byte width", () => {
    const bytes = new Uint8Array(32);
    for (const parse of [addressFromBase58, hashFromBase58]) {
      expect(parse(toBase58(bytes))).toEqual(bytes);
      for (const text of [
        "1".repeat(31),
        "1".repeat(33),
        "0x" + "00".repeat(32),
        addressToStrkey(bytes),
      ]) {
        expect(() => parse(text)).toThrow();
      }
    }
    expect(() => fixedFromBase58("1".repeat(63), 64)).toThrow();
    expect(fixedFromBase58("1".repeat(64), 64)).toEqual(new Uint8Array(64));
  });
});

describe("typed address and Stellar key input", () => {
  const z = "ZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZ4L";
  const c = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  const g = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const s = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSU2";

  it("preserves bytes and distinguishes addresses, keys, and seeds", () => {
    const bytes = new Uint8Array(32);
    expect(addressToStrkey(bytes)).toBe(z);
    expect(publicKeyToStrkey(bytes)).toBe(g);
    expect(secretSeedToStrkey(bytes)).toBe(s);
    expect(parseAddress(z)).toEqual(bytes);
    expect(() => parseAddress(c)).toThrow();
    expect(parsePublicKey(g)).toEqual(bytes);
    expect(parseSecretSeed(s)).toEqual(bytes);
    expect(() => parseAddress(g)).toThrow();
    expect(() => parseAddress(s)).toThrow();
    expect(() => parsePublicKey(c)).toThrow();
    expect(() => parsePublicKey(z)).toThrow();
    expect(() => parseSecretSeed(g)).toThrow();
    expect(() => parseSecretSeed(c)).toThrow();
    expect(() => parseSecretSeed(z)).toThrow();
    expect(() => parsePublicKey(g.toLowerCase())).toThrow();
    expect(() => parseAddress(z + "=")).toThrow();
    expect(() => parsePublicKey(g.slice(0, -1) + "G")).toThrow();
    for (const text of [z, c, g, s])
      expect(() => fixedFromBase58(text, 32)).toThrow();
    expect(() => parseSecretSeed("SECRET")).toThrow(
      "Expected a 32-byte base58 value or a valid S StrKey",
    );
  });

  it("matches the Rust Z vectors and validates the version checksum", () => {
    const vectors: [Uint8Array, string][] = [
      [
        new Uint8Array(32).fill(1),
        "ZAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDWEJ",
      ],
      [
        new Uint8Array(32).fill(255),
        "ZD777777777777777777777777777777777777777777777777777UYP",
      ],
      [
        Uint8Array.from({ length: 32 }, (_, index) => index),
        "ZAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB7GCZ",
      ],
    ];
    for (const [bytes, expected] of vectors) {
      expect(addressToStrkey(bytes)).toBe(expected);
      expect(parseAddress(expected)).toEqual(bytes);
    }
    for (const text of [
      z.toLowerCase(),
      ` ${z}`,
      `${z}\n`,
      `${z.slice(0, -1)}A`,
      `Z${c.slice(1)}`,
      z.slice(1),
      `${z}A`,
    ])
      expect(() => parseAddress(text)).toThrow();
  });

  it("matches the nonzero SEP-23 public-key vector", () => {
    const bytes = Uint8Array.from([
      63, 12, 52, 191, 147, 173, 13, 153, 113, 208, 76, 204, 144, 247, 5, 81,
      28, 131, 138, 173, 151, 52, 164, 162, 251, 13, 122, 3, 252, 127, 232, 154,
    ]);
    const text = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    expect(publicKeyToStrkey(bytes)).toBe(text);
    expect(parsePublicKey(text)).toEqual(bytes);
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
