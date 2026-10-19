import { hashFromBase58 } from "../../encoding.js";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { NetworkInfo } from "../../types/rpc.js";
import { networkHash } from "@thruputchain/protocol";

/** Return the immutable identity configured for an RPC endpoint. */
export async function getNetworkInfo(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<NetworkInfo> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_networkInfo",
    undefined,
    options,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid network info response");
  }

  const network = result as Record<string, unknown>;
  try {
    return {
      networkHash: networkHash(hashFromBase58(network.networkHash as string)),
    };
  } catch (cause) {
    throw new Error(
      "Invalid network info response: expected canonical networkHash",
      { cause },
    );
  }
}
