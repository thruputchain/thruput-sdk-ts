import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  ChainConfig,
  NetworkConfigParams,
  ExecutionConfig,
  StorageCosts,
} from "../../types/rpc.js";
import { I64_MAX, U64_MAX, parseDecimal } from "../decimal.js";
import { hashFromHex } from "../hex.js";

const MAX_U32 = 0xffff_ffff;

/**
 * Return the execution parameters the chain's network config states.
 *
 * Parameters the config leaves unstated are `null`. When supported, `execution`
 * pairs runtime-resolved limits and bigint storage prices with a committed tip
 * fetched during this request. Backends without that capability return only
 * cached stated fields. Read failures are propagated to the caller.
 */
export async function getChainConfig(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<ChainConfig> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_chainConfig",
    undefined,
    options,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid chain config response");
  }
  const config = result as Record<string, unknown>;
  return {
    ...parseLimits(config),
    ...(config.execution == null
      ? {}
      : { execution: parseExecution(config.execution) }),
  };
}

function parseLimits(config: Record<string, unknown>): NetworkConfigParams {
  const param = (field: keyof NetworkConfigParams) =>
    parseParam(config[field], field);
  return {
    maxAuthTokenDepth: param("maxAuthTokenDepth"),
    maxBytestringLen: param("maxBytestringLen"),
    maxContractSizeBytes: param("maxContractSizeBytes"),
    maxCrossInvokeDepth: param("maxCrossInvokeDepth"),
    maxNewContractsPerTx: param("maxNewContractsPerTx"),
    maxRv32CodeBytes: param("maxRv32CodeBytes"),
    maxRv32MemoryBytes: param("maxRv32MemoryBytes"),
    maxSavepointDepth: param("maxSavepointDepth"),
    maxSha256Buffers: param("maxSha256Buffers"),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid chain config response: expected object");
  }
  return value as Record<string, unknown>;
}

function parseExecution(value: unknown): ExecutionConfig {
  const config = object(value);
  const tip = object(config.observedTip);
  const costs = object(config.storageCosts);
  const height = parseDecimal(
    tip.height,
    "chain config response: observedTip.height",
    0n,
    I64_MAX,
  );
  const price = (field: keyof StorageCosts, maximum = U64_MAX) =>
    parseDecimal(
      costs[field],
      `chain config response: storageCosts.${field}`,
      0n,
      maximum,
    );
  if (
    typeof tip.blockHash !== "string" ||
    typeof config.configHash !== "string"
  ) {
    throw new Error("Invalid chain config response: invalid snapshot hash");
  }
  return {
    observedTip: {
      height,
      blockHash: hashFromHex(tip.blockHash),
    },
    configHash: hashFromHex(config.configHash),
    effectiveLimits: parseLimits(object(config.effectiveLimits)),
    storageCosts: {
      baseDataItemCost: price("baseDataItemCost"),
      bytestringCostPerByte: price("bytestringCostPerByte", BigInt(MAX_U32)),
      baseContractDeploymentCost: price("baseContractDeploymentCost"),
      contractDeploymentCostPerByte: price("contractDeploymentCostPerByte"),
      authPerKeyCost: price("authPerKeyCost"),
      rcqCostPerEntry: price("rcqCostPerEntry"),
      replayCacheCostPerEntry: price("replayCacheCostPerEntry"),
      balanceCost: price("balanceCost"),
    },
  };
}

function parseParam(value: unknown, field: string): number | null {
  // The server omits an unstated parameter; accept null for the same meaning.
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_U32
  ) {
    throw new Error(`Invalid chain config response: expected u32 ${field}`);
  }
  return value;
}
