/**
 * Minimal JSON-RPC transport contract used by all SDK actions.
 *
 * Implement this interface to plug the SDK into a custom runtime, test harness,
 * or request pipeline. The transport is responsible for sending a JSON-RPC
 * method name and params array, then returning the raw decoded `result` value.
 */
export interface Transport {
  /**
   * Send one JSON-RPC request and return the decoded `result` value.
   *
   * @typeParam T - Expected JSON-RPC result type before action-level parsing.
   */
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}
