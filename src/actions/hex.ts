import type { SHA256Hash, ContractAddress } from "@groundhogchain/protocol";
import {
  toHex,
  fromHex,
  sha256Hash,
  contractAddress,
} from "@groundhogchain/protocol";

export { toHex, fromHex } from "@groundhogchain/protocol";

export function toHex0x(bytes: Uint8Array): string {
  return "0x" + toHex(bytes);
}
export function fromHex0x(hex: string): Uint8Array {
  if (!hex.startsWith("0x"))
    throw new Error(`Expected 0x-prefixed hex string, got: ${hex}`);
  return fromHex(hex.slice(2));
}
export function hashFromHex(hex: string): SHA256Hash {
  return sha256Hash(fromHex0x(hex));
}
export function addressFromHex(hex: string): ContractAddress {
  return contractAddress(fromHex0x(hex));
}
