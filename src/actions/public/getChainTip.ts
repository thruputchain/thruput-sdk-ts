import type { Transport } from "../../transport/types.js";
import type { ChainTip } from "../../types/rpc.js";
import { hashFromHex } from "../hex.js";
import { requireObject, requireString, requireUint } from "../parse.js";

/** Return the latest block height and block hash reported by the gateway. */
export async function getChainTip(transport: Transport): Promise<ChainTip> {
  const result = await transport.request<unknown>("groundhog_chainTip");
  const tip = requireObject(result, "chain tip");

  return {
    height: requireUint(tip, "height", "chain tip"),
    blockHash: hashFromHex(requireString(tip, "blockHash", "chain tip")),
  };
}
