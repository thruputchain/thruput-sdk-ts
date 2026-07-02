import type { SHA256Hash, ContractAddress } from "@groundhogchain/protocol";
import {
  toHex,
  fromHex,
  sha256Hash,
  contractAddress,
} from "@groundhogchain/protocol";

export { toHex, fromHex } from "@groundhogchain/protocol";

/** Convert bytes to a `0x`-prefixed lowercase hex string. */
export function toHex0x(bytes: Uint8Array): string {
  return "0x" + toHex(bytes);
}

/** Decode a `0x`-prefixed hex string into bytes. */
export function fromHex0x(hex: string): Uint8Array {
  if (!hex.startsWith("0x"))
    throw new Error(`Expected 0x-prefixed hex string, got: ${hex}`);
  return fromHex(hex.slice(2));
}

/** Decode a `0x`-prefixed hex string into a protocol SHA-256 hash. */
export function hashFromHex(hex: string): SHA256Hash {
  return sha256Hash(fromHex0x(hex));
}

/** Decode a `0x`-prefixed hex string into a contract address. */
export function addressFromHex(hex: string): ContractAddress {
  return contractAddress(fromHex0x(hex));
}
