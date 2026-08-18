import { sha256 } from "@noble/hashes/sha2.js";
import { codec, serialize, sha256Hash } from "@groundhogchain/protocol";
import type { Contract, SHA256Hash } from "@groundhogchain/protocol";

/**
 * Return the network identity of a protocol contract.
 *
 * The hash covers the canonical encoded `Contract`, including its type and
 * payload framing. Hashing only the raw WASM or RV32 bytes produces a different
 * value and therefore a different derived address.
 *
 * @example
 * ```ts
 * import {
 *   deriveContractAddress,
 *   hashContract,
 * } from "@groundhogchain/client";
 *
 * const contractHash = hashContract(contract);
 * const address = deriveContractAddress(wallet, deploymentNonce, contractHash);
 * ```
 */
export function hashContract(contract: Contract): SHA256Hash {
  return sha256Hash(sha256(serialize(contract, codec.Contract)));
}
