import {
  codec,
  ContractType,
  deserialize,
  sha256Hash,
} from "@thruputchain/protocol";
import {
  readContractArtifactSpec,
  type ContractArtifactSpec,
} from "../../contract/artifact.js";
import { bytesEqual } from "../../contract/event.js";
import type { RpcClient } from "../../rpc/client.js";
import type {
  RpcContractDeployment,
  RpcContractDeploymentResult,
} from "../../rpc/generated.js";
import type { TransportRequestOptions } from "../../transport/types.js";

/** Snapshot deployment evidence and its authenticated metadata, if deployed. */
export interface ContractSpecResult extends RpcContractDeploymentResult {
  artifactSpec: ContractArtifactSpec | null;
}

/**
 * Resolve a current deployment and verify its embedded spec against its hash.
 * Missing artifacts and invalid responses throw; neither means no deployment.
 * The snapshot does not establish which implementation produced historical events.
 */
export async function getContractSpec(
  client: RpcClient,
  request: { address: Uint8Array },
  options?: TransportRequestOptions,
): Promise<ContractSpecResult> {
  client.requireMethods(["getContractDeployment", "getContractArtifact"]);
  const address = new Uint8Array(request.address);
  const result = await client.getContractDeployment({ address }, options);
  if (!bytesEqual(address, result.address))
    throw new Error("Contract deployment address mismatch");
  if (result.deployment === null) return { ...result, artifactSpec: null };
  return {
    ...result,
    artifactSpec: await readDeploymentSpec(client, result.deployment, options),
  };
}

/** Shared identity validation for explicit deployments and effective contract selection. */
export async function readDeploymentSpec(
  client: RpcClient,
  deployment: RpcContractDeployment,
  options?: TransportRequestOptions,
): Promise<ContractArtifactSpec> {
  const artifact = await client.getContractArtifact(
    { hash: deployment.hash },
    options,
  );
  if (!bytesEqual(artifact.hash, deployment.hash))
    throw new Error("Contract artifact response hash mismatch");
  const artifactSpec = readContractArtifactSpec(
    artifact.contractXdr,
    sha256Hash(deployment.hash),
  );
  const contract = deserialize(artifact.contractXdr, codec.Contract);
  const size =
    contract.contract_type === ContractType.kRv32
      ? contract.rv32_contract.data.length
      : 0;
  if (
    contract.contract_type !== deployment.contractType ||
    size !== deployment.size
  ) {
    throw new Error("Contract artifact does not match deployment metadata");
  }
  return artifactSpec;
}
