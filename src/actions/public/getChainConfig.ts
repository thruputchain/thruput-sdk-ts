import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { NetworkConfigParams } from "../../types/rpc.js";

const MAX_U32 = 0xffff_ffff;

/**
 * Return the execution parameters the chain's network config states.
 *
 * The server answers from a tip reading it refreshes at most once per cache
 * window, so a config upgrade can take that long to appear. Parameters the
 * config leaves unstated are `null`.
 */
export async function getChainConfig(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<NetworkConfigParams> {
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
