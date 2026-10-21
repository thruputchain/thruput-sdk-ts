import { NativeRpcError } from "../rpc/errorReader.js";
import { UnsupportedRpcValue } from "../rpc/codec.js";
import type { RpcErrorData } from "../rpc/generated.js";
/** A validated native admission bound violation. Unknown details remain on the raw error. */
export type TxInvalidDetail = Exclude<
  NonNullable<Extract<RpcErrorData, { kind: "transactionInvalid" }>["detail"]>,
  UnsupportedRpcValue
>;
/** Read known transaction-bound evidence without inferring retry permission. */
export function txInvalidDetail(error: unknown): TxInvalidDetail | null {
  if (
    !(error instanceof NativeRpcError) ||
    error.decoded.classification !== "known" ||
    error.decoded.data.kind !== "transactionInvalid"
  )
    return null;
  const detail = error.decoded.data.detail;
  return !detail || detail instanceof UnsupportedRpcValue ? null : detail;
}
