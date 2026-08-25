import type { Transport } from "../../transport/types.js";
import {
  blockHeight,
  networkHash,
  protocol,
  timePoint,
  validatorID,
} from "@groundhogchain/protocol";
import type { BlockInfo } from "../../types/rpc.js";
import { fromHex0x, hashFromHex } from "../hex.js";

interface RawBlockInfo {
  blockHash: string;
  protocol: number | string;
  networkHash: string;
  proposer: string;
  blockTimepoint: number | string;
  blockHeight: number | string;
  txsHash: string;
  storageHash: string;
  eventsHash: string;
  prevBlockHash: string;
  proposalTxsHash: string;
  upgrades: string[];
}

/** Return block metadata for a height, or `null` when the block is unknown. */
export async function getBlockByNumber(
  transport: Transport,
  height: bigint,
): Promise<BlockInfo | null> {
  if (height < 0n || height > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("height must be a non-negative safe integer");
  }
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
    blockHash: parseHash(block.blockHash, "blockHash"),
    protocol: protocol(parseInteger(block.protocol, "protocol")),
    networkHash: networkHash(parseHash(block.networkHash, "networkHash")),
    proposer: validatorID(parseFixedBytes(block.proposer, "proposer")),
    blockTimepoint: timePoint(
      parseInteger(block.blockTimepoint, "blockTimepoint"),
    ),
    blockHeight: blockHeight(parseInteger(block.blockHeight, "blockHeight")),
    txsHash: parseHash(block.txsHash, "txsHash"),
    storageHash: parseHash(block.storageHash, "storageHash"),
    eventsHash: parseHash(block.eventsHash, "eventsHash"),
    prevBlockHash: parseHash(block.prevBlockHash, "prevBlockHash"),
    proposalTxsHash: parseHash(block.proposalTxsHash, "proposalTxsHash"),
    upgrades: parseUpgrades(block.upgrades),
  };
}

function parseHash(value: unknown, field: string) {
  return hashFromHex(parseCanonicalHex(value, field, 32));
}

function parseFixedBytes(value: unknown, field: string): Uint8Array {
  return fromHex0x(parseCanonicalHex(value, field, 32));
}

function parseCanonicalHex(
  value: unknown,
  field: string,
  byteLength?: number,
): string {
  const pattern =
    byteLength === undefined
      ? /^0x(?:[0-9a-f]{2})*$/
      : new RegExp(`^0x[0-9a-f]{${byteLength * 2}}$`);
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Invalid block response: expected canonical ${field}`);
  }
  return value;
}

function parseInteger(value: unknown, field: string): bigint {
  if (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
  ) {
    return BigInt(value);
  }
  throw new Error(`Invalid block response: expected non-negative ${field}`);
}

function parseUpgrades(value: unknown): Uint8Array[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid block response: expected upgrades");
  }
  return value.map((upgrade) =>
    fromHex0x(parseCanonicalHex(upgrade, "upgrade")),
  );
}
