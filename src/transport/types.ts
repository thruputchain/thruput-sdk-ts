/**
 * Minimal JSON-RPC transport contract used by all SDK actions.
 *
 * Implement this interface to plug the SDK into a custom runtime, test harness,
 * or request pipeline. The transport is responsible for sending a JSON-RPC
 * method name and named params object, then returning the raw decoded `result` value.
 *
 * Report failures with `ThruputError`, imported from `@thruputchain/client`, so
 * native clients can classify them:
 *
 * - A JSON-RPC error object: code `rpcError`, with the complete object in `context.raw`.
 * - A network failure: code `httpRequestFailed`.
 * - A failed HTTP status: code `httpResponseError`.
 * - A malformed reply: code `rpcResponseInvalid`.
 *
 * @example
 * ```ts
 * throw new ThruputError("rpcError", "getChainTip: Overloaded (RPC -32053)", {
 *   context: { code: -32053, rpcMessage: "Overloaded", method: "getChainTip", raw },
 * });
 * ```
 */
export interface Transport {
  /**
   * Send one JSON-RPC request and return the decoded `result` value.
   *
   * @typeParam T - Expected JSON-RPC result type before action-level parsing.
   */
  request<T = unknown>(
    method: string,
    params?: RpcParams,
    options?: TransportRequestOptions,
  ): Promise<T>;
}

/** Per-request transport controls supported by built-in transports. */
export interface TransportRequestOptions {
  /**
   * Cancel this request without affecting other requests on the same transport.
   * Public reads accept these options as their final argument; generated view
   * methods accept signal alongside their contract arguments.
   */
  readonly signal?: AbortSignal;
}

/** Named native parameters; arrays remain accepted by the general JSON-RPC transport. */
export type RpcParams = Record<string, unknown> | unknown[];
