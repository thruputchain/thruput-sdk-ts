import { base32nopad } from "@scure/base";
import { fromBase58 } from "@thruputchain/protocol/utils";
import { contractAddress, sha256Hash } from "@thruputchain/protocol";
import type { ContractAddress, SHA256Hash } from "@thruputchain/protocol";

const ADDRESS_STRKEY_VERSION = 25 << 3;

export {
  toBase58,
  fromBase58,
  maxBase58Length,
} from "@thruputchain/protocol/utils";

/** Decode exactly the expected number of bytes, with no format fallback. */
export function fixedFromBase58(text: string, byteLength: number): Uint8Array {
  const bytes = fromBase58(text, byteLength);
  if (bytes.length !== byteLength) {
    bytes.fill(0);
    throw new Error(`Expected ${byteLength} bytes`);
  }
  return bytes;
}

/** Decode a canonical base58 Thruput address, without account derivation. */
export function addressFromBase58(text: string): ContractAddress {
  return contractAddress(fixedFromBase58(text, 32));
}

/** Decode a canonical base58 SHA-256 hash. */
export function hashFromBase58(text: string): SHA256Hash {
  return sha256Hash(fixedFromBase58(text, 32));
}

// SEP-23 CRC16-XModem: polynomial 0x1021, initial value zero, little-endian
// checksum bytes. This is typo detection, not cryptographic authentication.
function checksum(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc;
}

function strkey(bytes: Uint8Array, version: number): string {
  if (bytes.length !== 32) throw new Error("Expected 32 bytes");
  const encoded = new Uint8Array(35);
  try {
    encoded[0] = version;
    encoded.set(bytes, 1);
    const crc = checksum(encoded.subarray(0, 33));
    encoded[33] = crc & 0xff;
    encoded[34] = crc >>> 8;
    return base32nopad.encode(encoded);
  } finally {
    encoded.fill(0);
  }
}

function parseTyped(text: string, version: number, prefix: string): Uint8Array {
  // A 32-byte base58 value is at most 44 characters. Z/G/S StrKeys have 56.
  // Dispatch by full length, never by a prefix that valid base58 can share.
  if (typeof text === "string" && text.length === 56) {
    let decoded: Uint8Array | undefined;
    try {
      decoded = base32nopad.decode(text);
      if (
        decoded.length === 35 &&
        decoded[0] === version &&
        base32nopad.encode(decoded) === text &&
        checksum(decoded.subarray(0, 33)) ===
          (decoded[33]! | (decoded[34]! << 8))
      ) {
        return decoded.slice(1, 33);
      }
    } catch {
      // Return the same redacted error for malformed and wrong-type StrKeys.
    } finally {
      decoded?.fill(0);
    }
  } else {
    try {
      return fixedFromBase58(text, 32);
    } catch {
      // Do not expose input (which may be a secret seed) in errors.
    }
  }
  throw new Error(
    `Expected a 32-byte base58 value or a valid ${prefix} StrKey`,
  );
}

/**
 * Parse human address input: base58 or Thruput Z StrKey, without account derivation.
 * Stellar C addresses are rejected. Z does not identify a specific Thruput network.
 */
export function parseAddress(text: string): ContractAddress {
  return contractAddress(parseTyped(text, ADDRESS_STRKEY_VERSION, "Z"));
}

/** Parse human Ed25519 key input: base58 or G StrKey, never a wallet address. */
export function parsePublicKey(text: string): Uint8Array {
  return parseTyped(text, 6 << 3, "G");
}

/**
 * Explicitly import a 32-byte Ed25519 seed from base58 or S StrKey.
 * Callers must clear returned bytes after use. JavaScript input strings cannot
 * be reliably erased; do not log or persist them in diagnostics.
 */
export function parseSecretSeed(text: string): Uint8Array {
  return parseTyped(text, 18 << 3, "S");
}

/** Render address bytes as a Thruput Z StrKey, without a specific network identity. */
export function addressToStrkey(bytes: Uint8Array): string {
  return strkey(bytes, ADDRESS_STRKEY_VERSION);
}

/** Render an Ed25519 public key as a G StrKey, without deriving an address. */
export function publicKeyToStrkey(bytes: Uint8Array): string {
  return strkey(bytes, 6 << 3);
}

/** Explicitly export a seed as an S StrKey. Treat the returned string as secret. */
export function secretSeedToStrkey(bytes: Uint8Array): string {
  return strkey(bytes, 18 << 3);
}
