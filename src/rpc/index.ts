/** Native JSON-RPC calls, validated codecs and explicit endpoint discovery. */
export { createRpcClient, RpcCompatibilityError } from "./client.js";
export type {
  RpcClient,
  RpcClientOptions,
  RpcDiscovery,
  RpcMethod,
  RpcMethods,
} from "./client.js";
export {
  UnsupportedRpcValue,
  RpcDecodingError,
  RpcRequestValidationError,
} from "./codec.js";
export { NativeRpcErrorCode } from "./errors.js";
export type * from "./generated.js";

export { NativeRpcError } from "./errorReader.js";
export type { DecodedRpcError } from "./errorReader.js";
