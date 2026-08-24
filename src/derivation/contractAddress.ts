import { sha256 } from "@noble/hashes/sha2.js";
import { codec, contractAddress, serialize } from "@groundhogchain/protocol";
import type { ContractAddress, SHA256Hash } from "@groundhogchain/protocol";

/**
 * The on-chain address a deployment produces:
 * `sha256(txs(ContractDeploymentHashPreimage))` over the deployer, nonce, and
 * contract hash.
 */
export function deriveContractAddress(
  deployer: ContractAddress,
  nonce: SHA256Hash,
  contractHash: SHA256Hash,
): ContractAddress {
  const preimage = serialize(
    { deployer_address: deployer, nonce, contract_hash: contractHash },
    codec.ContractDeploymentHashPreimage,
  );
  return contractAddress(sha256(preimage));
}
