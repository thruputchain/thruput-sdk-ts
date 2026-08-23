import type { Transport } from "../../transport/types.js";
import type { NetworkInfo } from "../../types/rpc.js";
import { hashFromHex } from "../hex.js";

const CANONICAL_SHA256_HASH = /^0x[0-9a-f]{64}$/;

/** Return the immutable identity configured for an RPC endpoint. */
export async function getNetworkInfo(
  transport: Transport,
): Promise<NetworkInfo> {
  const result = await transport.request<unknown>("groundhog_networkInfo");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid network info response");
  }

  const network = result as Record<string, unknown>;
  if (
    typeof network.networkId !== "string" ||
    network.networkId.trim().length === 0
  ) {
    throw new Error("Invalid network info response: expected networkId");
  }
  if (
    typeof network.genesisHash !== "string" ||
    !CANONICAL_SHA256_HASH.test(network.genesisHash)
  ) {
    throw new Error(
      "Invalid network info response: expected canonical genesisHash",
    );
  }

  return {
    networkId: network.networkId,
    genesisHash: hashFromHex(network.genesisHash),
  };
}
