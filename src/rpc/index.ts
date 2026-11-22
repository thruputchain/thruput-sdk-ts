/** Native JSON-RPC calls, validated codecs and explicit endpoint discovery. */
export { createRpcClient } from "./client.js";
export type {
  RpcClient,
  RpcClientOptions,
  RpcDiscovery,
  RpcMethod,
  RpcMethods,
} from "./client.js";
export { UnsupportedRpcValue } from "./codec.js";
export { NativeRpcErrorCode } from "./errors.js";
export type * from "./generated.js";
