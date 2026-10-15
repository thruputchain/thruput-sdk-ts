import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import {
  blockHeight,
  networkHash,
  protocol,
  timePoint,
  validatorID,
} from "@thruputchain/protocol";
import type { BlockInfo } from "../../types/rpc.js";
import { fromHex0x, hashFromHex } from "../hex.js";
import { parseHeight, parseU64, serializeHeight } from "../decimal.js";

interface RawBlockInfo {
  blockHash: string;
  protocol: number;
  networkHash: string;
  proposer: string;
  blockTimepoint: string;
  blockHeight: string;
  txsHash: string;
  storageHash: string;
  eventsHash: string;
  configHash: string;
  prevBlockHash: string;
  proposalTxsHash: string;
  upgrades: string[];
}

/**
 * Return committed block metadata, or null outside indexed coverage, including
 * genesis. Backend unavailability is an error, not a missing or empty block.
 */
export async function getBlockByNumber(
  transport: Transport,
  height: bigint,
  options?: TransportRequestOptions,
): Promise<BlockInfo | null> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_getBlockByNumber",
    [serializeHeight(height)],
    options,
  );
  if (result === null) return null;

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid block response");
  }
  const block = result as RawBlockInfo;
  const returnedHeight = parseHeight(block.blockHeight, "blockHeight");
  if (returnedHeight !== height) {
    throw new Error("Invalid block response: height does not match request");
  }

  return {
    blockHash: parseHash(block.blockHash, "blockHash"),
    protocol: protocol(parseInteger(block.protocol, "protocol")),
    networkHash: networkHash(parseHash(block.networkHash, "networkHash")),
    proposer: validatorID(parseFixedBytes(block.proposer, "proposer")),
    blockTimepoint: timePoint(parseU64(block.blockTimepoint, "blockTimepoint")),
    blockHeight: blockHeight(returnedHeight),
    txsHash: parseHash(block.txsHash, "txsHash"),
    storageHash: parseHash(block.storageHash, "storageHash"),
    eventsHash: parseHash(block.eventsHash, "eventsHash"),
    configHash: parseHash(block.configHash, "configHash"),
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
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff
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
