import { createRpcClient } from "../rpc/client.js";
import { MockTransport } from "../transport/mock.js";
import type {
  RpcParams,
  Transport,
  TransportRequestOptions,
} from "../transport/types.js";

/** Test transport that supplies genuine native discovery before a method-specific fixture. */
export function withNativeDiscovery(
  transport: Transport,
  networkHash?: string,
): Transport {
  const defaults = new MockTransport();
  return {
    async request<T>(
      method: string,
      params?: RpcParams,
      options?: TransportRequestOptions,
    ): Promise<T> {
      if (method === "getVersionInfo" || method === "getServerLimits")
        return defaults.request<T>(method, params, options);
      if (method === "getNetworkInfo" && networkHash !== undefined)
        return { networkHash } as T;
      return transport.request<T>(method, params, options);
    },
  };
}
export async function testRpc(transport: Transport) {
  return createRpcClient({
    transport: withNativeDiscovery(transport, "1".repeat(32)),
  });
}
