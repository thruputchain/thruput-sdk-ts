import { describe, expect, it } from "vitest";
import {
  CryptographicScheme,
  codec,
  ed25519PublicKey,
  fromHex,
  mlDsa65PublicKey,
  serializeCxs,
  toHex,
} from "@thruputchain/protocol";
import type { PubkeyAccountPreimage } from "@thruputchain/protocol";
import { sha256 } from "@noble/hashes/sha2.js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DomainSeparator,
  PUBKEY_ACCOUNT,
  PUBLIC_KEY,
} from "./domainSeparator.js";
import { derivePublicKeyHash } from "./publicKeyHash.js";
import {
  derivePubkeyAccountAddress,
  pubkeyAccountPreimage,
} from "./pubkeyAccount.js";

interface Vector {
  domain_separator: string;
  domain_separator_cxs_hex: string;
  expected_address_hex: string;
  nonce: string;
  preimage_cxs_hex: string;
  pubkey_hex: string;
}

interface VectorFile {
  version: number;
  category: string;
  vectors: Vector[];
}

// Generated, not committed: CI regenerates from the published
// thruput-test-vectors crate; run scripts/regen-test-vectors.sh locally.
const vectorsPath = fileURLToPath(
  new URL("../../specs/test-vectors/domain-separator.json", import.meta.url),
);
const haveVectors = existsSync(vectorsPath);
const vectorFile: VectorFile = haveVectors
  ? (JSON.parse(readFileSync(vectorsPath, "utf-8")) as VectorFile)
  : { version: 0, category: "", vectors: [] };
const vectors: Vector[] = vectorFile.vectors;

function preimageOf(v: Vector): PubkeyAccountPreimage {
  return pubkeyAccountPreimage(
    {
      scheme: CryptographicScheme.Ed25519,
      ed25519: ed25519PublicKey(fromHex(v.pubkey_hex)),
    },
    BigInt(v.nonce),
  );
}

describe.skipIf(!haveVectors)(
  "golden vectors (domain_separator_pubkey_account)",
  () => {
    it("loads the expected vector category", () => {
      expect(vectorFile.category).toBe("domain_separator_pubkey_account");
      expect(vectors.length).toBeGreaterThan(0);
    });

    it.each(vectors.map((v) => [v.nonce, v] as const))(
      "nonce=%s: separator prefix matches domain_separator_cxs_hex",
      (_nonce, v) => {
        const sep = DomainSeparator.make(v.domain_separator);
        expect(toHex(sep.bytes)).toBe(v.domain_separator_cxs_hex);
      },
    );

    it.each(vectors.map((v) => [v.nonce, v] as const))(
      "nonce=%s: preimage CXS encoding matches preimage_cxs_hex",
      (_nonce, v) => {
        const bytes = serializeCxs(preimageOf(v), codec.PubkeyAccountPreimage);
        expect(toHex(bytes)).toBe(v.preimage_cxs_hex);
      },
    );

    it.each(vectors.map((v) => [v.nonce, v] as const))(
      "nonce=%s: derived address matches expected_address_hex",
      (_nonce, v) => {
        const address = derivePubkeyAccountAddress(preimageOf(v));
        expect(toHex(address)).toBe(v.expected_address_hex);
      },
    );
  },
);

describe("DomainSeparator", () => {
  it("hashObject equals sha256 of the manual prefix || cxs concatenation", () => {
    const preimage = preimageOf({
      domain_separator: "PubkeyAccount",
      domain_separator_cxs_hex: "",
      expected_address_hex: "",
      nonce: "42",
      preimage_cxs_hex: "",
      pubkey_hex: "07".repeat(32),
    });
    const objectCxs = serializeCxs(preimage, codec.PubkeyAccountPreimage);
    const manual = new Uint8Array(
      PUBKEY_ACCOUNT.bytes.length + objectCxs.length,
    );
    manual.set(PUBKEY_ACCOUNT.bytes, 0);
    manual.set(objectCxs, PUBKEY_ACCOUNT.bytes.length);
    expect(
      toHex(PUBKEY_ACCOUNT.hashObject(preimage, codec.PubkeyAccountPreimage)),
    ).toEqual(toHex(sha256(manual)));
  });

  it("accepts a 256-byte name and rejects a 257-byte one", () => {
    expect(() => DomainSeparator.make("a".repeat(256))).not.toThrow();
    expect(() => DomainSeparator.make("a".repeat(257))).toThrow(/256/);
  });

  it("measures the name length in UTF-8 bytes, not code units", () => {
    // 128 four-byte code points: 128 UTF-16 length, 512 UTF-8 bytes.
    expect(() => DomainSeparator.make("\u{1F600}".repeat(128))).toThrow(/256/);
  });
});

describe("derivePublicKeyHash", () => {
  const ed25519Key = {
    scheme: CryptographicScheme.Ed25519,
    ed25519: ed25519PublicKey(new Uint8Array(32).fill(7)),
  } as const;

  it("hashes the PublicKey separator then the CXS-encoded key", () => {
    expect(toHex(PUBLIC_KEY.bytes)).toBe(
      toHex(
        new Uint8Array([0x00, 0x09, ...new TextEncoder().encode("PublicKey")]),
      ),
    );
    const objectCxs = serializeCxs(ed25519Key, codec.PublicKey);
    const manual = new Uint8Array(PUBLIC_KEY.bytes.length + objectCxs.length);
    manual.set(PUBLIC_KEY.bytes, 0);
    manual.set(objectCxs, PUBLIC_KEY.bytes.length);
    expect(toHex(derivePublicKeyHash(ed25519Key))).toBe(toHex(sha256(manual)));
  });

  it("commits to the scheme as well as the key bytes", () => {
    const mlDsaKey = {
      scheme: CryptographicScheme.MlDsa65,
      mldsa65: mlDsa65PublicKey(new Uint8Array(1952).fill(7)),
    } as const;
    expect(toHex(derivePublicKeyHash(mlDsaKey))).not.toBe(
      toHex(derivePublicKeyHash(ed25519Key)),
    );
  });

  it("names the key by hash in the account preimage", () => {
    expect(pubkeyAccountPreimage(ed25519Key, 5n)).toEqual({
      pubkey_hash: derivePublicKeyHash(ed25519Key),
      nonce: 5n,
    });
    expect(
      serializeCxs(
        pubkeyAccountPreimage(ed25519Key, 5n),
        codec.PubkeyAccountPreimage,
      ).subarray(0, 32),
    ).toEqual(derivePublicKeyHash(ed25519Key));
  });
});
