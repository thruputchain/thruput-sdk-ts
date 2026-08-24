import type { Transport } from "../../transport/types.js";
import { storageLongHash } from "@groundhogchain/protocol";
import type { BlockInfo } from "../../types/rpc.js";
import { fromHex0x, hashFromHex } from "../hex.js";
import { requireObject, requireString, requireUint } from "../parse.js";
import { toJsonNumber } from "../serialize.js";

/** Return block metadata for a height, or `null` when the block is unknown. */
export async function getBlockByNumber(
  transport: Transport,
  height: bigint,
): Promise<BlockInfo | null> {
  const result = await transport.request<unknown>(
    "groundhog_getBlockByNumber",
    [toJsonNumber(height, "block height")],
  );
  if (result === null) return null;

  const block = requireObject(result, "block");

  return {
    networkId: requireUint(block, "networkId", "block"),
    blockHeight: requireUint(block, "blockHeight", "block"),
    txsetHash: hashFromHex(requireString(block, "txsetHash", "block")),
    dbHash: storageLongHash(fromHex0x(requireString(block, "dbHash", "block"))),
    eventsHash: hashFromHex(requireString(block, "eventsHash", "block")),
    prevBlockHash: hashFromHex(requireString(block, "prevBlockHash", "block")),
  };
}
