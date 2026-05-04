import type { Transport } from "../../transport/types.js";
import type { ChainTip } from "../../types/rpc.js";
import { hashFromHex } from "../hex.js";

export async function getChainTip(transport: Transport): Promise<ChainTip> {
  const result = await transport.request<{ height: string; blockHash: string }>(
    "groundhog_chainTip",
  );
  return {
    height: BigInt(result.height),
    blockHash: hashFromHex(result.blockHash),
  };
}
