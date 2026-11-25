import type { ThruputErrorCode } from "../errors/codes.js";
import { ThruputError } from "../errors/thruputError.js";
import {
  WalletProviderError,
  type WalletProviderErrorCode,
} from "../provider/types.js";

/** The app-layer code for each wire code of the wallet provider contract. */
const codes = {
  4001: "userRejected",
  4100: "walletUnauthorized",
  4200: "walletMethodUnsupported",
  4900: "walletDisconnected",
  4901: "walletNetworkMismatch",
  [-32602]: "walletInvalidParams",
  [-32603]: "walletInternalError",
  [-32002]: "walletRequestPending",
} as const satisfies Record<WalletProviderErrorCode, ThruputErrorCode>;

/** An app-layer wallet error, keeping the wire code in `context.providerCode`. */
export function providerError(
  providerCode: WalletProviderErrorCode,
  message: string,
): ThruputError<(typeof codes)[WalletProviderErrorCode]> {
  return new ThruputError(codes[providerCode], message, {
    context: { providerCode },
  });
}

/** Convert a wire `WalletProviderError` to its app-layer error. Keep other errors. */
export function toAppError(error: unknown): unknown {
  return error instanceof WalletProviderError
    ? providerError(error.code, error.message)
    : error;
}
