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

/** Return block metadata for a height, or `null` when the block is unknown. */
export async function getBlockByNumber(
  transport: Transport,
  height: bigint,
): Promise<BlockInfo | null> {
  const result = await transport.request<unknown>(
    "groundhog_getBlockByNumber",
    [Number(height)],
  );
  if (result === null) return null;

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid block response");
  }
  const block = result as RawBlockInfo;

  return {
    networkId: BigInt(block.networkId),
    blockHeight: BigInt(block.blockHeight),
    txsetHash: hashFromHex(block.txsetHash),
    dbHash: dbHash(fromHex0x(block.dbHash)),
    eventsHash: hashFromHex(block.eventsHash),
    prevBlockHash: hashFromHex(block.prevBlockHash),
  };
}
