import { isThruputError } from "../errors/thruputError.js";
import {
  isUnsupportedRpcValue,
  type UnsupportedRpcValue,
} from "../rpc/unsupported.js";
import type { RpcErrorData } from "../rpc/generated.js";
/** A validated native admission bound violation. Unknown details remain on the raw error. */
export type TxInvalidDetail = Exclude<
  NonNullable<Extract<RpcErrorData, { kind: "transactionInvalid" }>["detail"]>,
  UnsupportedRpcValue
>;
/** Read known transaction-bound evidence without inferring retry permission. */
export function txInvalidDetail(error: unknown): TxInvalidDetail | null {
  if (
    !isThruputError(error, "nativeRpcError") ||
    error.context.kind !== "transactionInvalid"
  )
    return null;
  const detail = error.context.data.detail;
  return !detail || isUnsupportedRpcValue(detail) ? null : detail;
}
