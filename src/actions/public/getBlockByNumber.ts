import type { Transport } from "../../transport/types.js";
import { dbHash } from "@groundhogchain/protocol";
import type { BlockInfo } from "../../types/rpc.js";
import { fromHex0x, hashFromHex } from "../hex.js";

interface RawBlockInfo {
  networkId: number | string;
  blockHeight: number | string;
  txsetHash: string;
  dbHash: string;
  eventsHash: string;
  prevBlockHash: string;
}

export async function getBlockByNumber(
  transport: Transport,
  height: bigint,
): Promise<BlockInfo | null> {
  const result = await transport.request<RawBlockInfo | null>(
    "groundhog_getBlockByNumber",
    [Number(height)],
  );
  if (result === null) return null;
  return {
    networkId: BigInt(result.networkId),
    blockHeight: BigInt(result.blockHeight),
    txsetHash: hashFromHex(result.txsetHash),
    dbHash: dbHash(fromHex0x(result.dbHash)),
    eventsHash: hashFromHex(result.eventsHash),
    prevBlockHash: hashFromHex(result.prevBlockHash),
  };
}
