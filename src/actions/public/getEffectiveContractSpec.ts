import {
  ContractType,
  HogexecPrecompiledNativeContracts,
} from "@thruputchain/protocol";
import { hashContract } from "../../contract/hash.js";
import { bytesEqual } from "../../contract/event.js";
import type { ContractArtifactSpec } from "../../contract/artifact.js";
import { spec as defaultWalletSpec } from "../../contracts/default_wallet.js";
import type { ContractSpec } from "../../contract/spec.js";
import type { RpcClient } from "../../rpc/client.js";
import type { RpcEffectiveContractResult } from "../../rpc/generated.js";
import { UnsupportedRpcValue } from "../../rpc/codec.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import { readDeploymentSpec } from "./getContractSpec.js";

const nativeWalletHash = hashContract({
  contract_type: ContractType.kNative,
  native_contract_id:
    HogexecPrecompiledNativeContracts.kNativeContractDefaultWallet,
});

export interface EffectiveContractSpecResult extends RpcEffectiveContractResult {
  artifactSpec: ContractArtifactSpec | null;
  /** Recognized native interface; not artifact-bound or proof of runtime code. */
  nativeInterface: { name: "DefaultWallet"; spec: ContractSpec } | null;
}

/**
 * Discover current contract selection without inferring authorization or historical identity.
 * Root context allows the chain-configured fallback; nested excludes that fallback.
 * Transaction-local deployments are outside this committed-state reading.
 */
export async function getEffectiveContractSpec(
  client: RpcClient,
  request: { address: Uint8Array; context: "root" | "nested" },
  options?: TransportRequestOptions,
): Promise<EffectiveContractSpecResult> {
  client.requireMethods(["getEffectiveContract", "getContractArtifact"]);
  const address = new Uint8Array(request.address);
  const context = request.context;
  const result = await client.getEffectiveContract(
    { address, context },
    options,
  );
  if (!bytesEqual(address, result.address) || result.context !== context)
    throw new Error("Effective contract request identity mismatch");
  if (result.selection instanceof UnsupportedRpcValue)
    throw new Error("Unsupported effective contract selection");
  if (result.selection === null)
    return { ...result, artifactSpec: null, nativeInterface: null };
  if (context === "nested" && result.selection.source === "networkDefault")
    throw new Error("Network default cannot apply to a nested invocation");
  const contract = result.selection.contract;
  const artifactSpec = await readDeploymentSpec(client, contract, options);
  const nativeInterface =
    artifactSpec.kind === "native" &&
    bytesEqual(contract.hash, nativeWalletHash)
      ? { name: "DefaultWallet" as const, spec: defaultWalletSpec }
      : null;
  return { ...result, artifactSpec, nativeInterface };
}
