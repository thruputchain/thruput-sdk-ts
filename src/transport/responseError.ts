/** Malformed JSON-RPC reply after dispatch. Raw data is retained; write outcome is unknown. */
export class RpcResponseError extends Error {
  constructor(
    message: string,
    readonly raw: unknown,
  ) {
    super(message);
    this.name = "RpcResponseError";
  }
}
