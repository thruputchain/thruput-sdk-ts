import type { ContractAddress } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { StorageItemInfo, StorageItemRead } from "../../types/rpc.js";
import { fromHex0x, hashFromHex, toHex0x } from "../hex.js";
import { requireObject, requireString, requireUint } from "../parse.js";

/**
 * Read a committed storage item at a contract address and 32-byte storage key.
 *
 * The gateway returns typed storage variants for known protocol storage kinds
 * and `null` when no item exists at the key.
 */
export async function getStorageAt(
  transport: Transport,
  address: ContractAddress,
  key: Uint8Array,
): Promise<StorageItemRead> {
  // Mirror the server-side rpc-server validation so callers see a
  // typed error before the request leaves the client.
  if (key.length !== 32) {
    throw new Error(
      `getStorageAt: storage key must be exactly 32 bytes, got ${key.length}`,
    );
  }
  const result = await transport.request<unknown>("groundhog_getStorageAt", [
    toHex0x(address),
    toHex0x(key),
  ]);

  const read = requireObject(result, "storage");

  return {
    blockHeight: requireUint(read, "blockHeight", "storage"),
    item:
      read.item !== undefined && read.item !== null
        ? parseStorageItemInfo(read.item)
        : null,
  };
}

function parseStorageItemInfo(raw: unknown): StorageItemInfo {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "unknown", typeId: -1 };
  }
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "nonnegativeInt":
      return {
        kind: "nonnegativeInt",
        value: requireUint(r, "value", "storage"),
      };
    case "bytestring":
      return {
        kind: "bytestring",
        bytes: fromHex0x(requireString(r, "bytes", "storage")),
      };
    case "authData":
      return { kind: "authData" };
    case "retrocausalQueue":
      return { kind: "retrocausalQueue" };
    case "replayCacheEntry":
      return { kind: "replayCacheEntry" };
    case "deployedContract":
      return {
        kind: "deployedContract",
        hash: hashFromHex(requireString(r, "hash", "storage")),
        size: Number(requireUint(r, "size", "storage")),
        contractType: Number(requireUint(r, "contractType", "storage")),
      };
    case "unknown":
      return { kind: "unknown", typeId: Number(r.typeId) };
    default:
      // A `kind` string this client doesn't recognize means the server
      // ships a newer protocol than the build we're against.  Surface
      // it as Unknown — preserve the protocol type id when present so
      // callers can log/route on it; fall back to -1 when absent (the
      // server didn't help us identify the variant).
      return {
        kind: "unknown",
        typeId: typeof r.typeId === "number" ? r.typeId : -1,
      };
  }
}
