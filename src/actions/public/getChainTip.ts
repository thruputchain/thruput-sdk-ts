import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { ChainTip } from "../../types/rpc.js";
import { hashFromHex } from "../hex.js";

interface RawChainTip {
  height: number | string;
  blockHash: string;
}

/** Return the latest block height and block hash reported by the gateway. */
export async function getChainTip(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<ChainTip> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_chainTip",
    undefined,
    options,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid chain tip response");
  }

  const tip = result as RawChainTip;

  return {
    height: BigInt(tip.height),
    blockHash: hashFromHex(tip.blockHash),
  };
}
