import {
  GroundhogRpcErrorCode,
  HttpRequestError,
  HttpResponseError,
  JsonRpcError,
} from "./http.js";
import type { TransportRequestOptions } from "./types.js";

/** Infrastructure failure classification; retry budgets remain with the caller. */
export type ReadErrorKind = "transient" | "permanent" | "cancelled" | "unknown";

/**
 * Classify an infrastructure read failure without replacing the original error.
 *
 * Pass the caller's signal to distinguish explicit cancellation from a transport
 * timeout. Plain Error wrappers are inspected through their causes; domain errors
 * and unrecognized failures remain unknown. A bare TypeError is not evidence of
 * a network failure. Custom transports should use HttpRequestError for that case.
 * Transaction-not-found remains operation-specific rather than a general retry.
 * This classification never authorizes transaction resubmission.
 */
export function classifyReadError(
  error: unknown,
  options: TransportRequestOptions = {},
): ReadErrorKind {
  if (options.signal?.aborted) return "cancelled";
  const seen = new Set<unknown>();
  while (error !== null && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if (error instanceof HttpRequestError) return "transient";
    if (error instanceof HttpResponseError) {
      return [408, 429, 500, 502, 503, 504].includes(error.status)
        ? "transient"
        : "permanent";
    }
    if (error instanceof JsonRpcError) {
      switch (error.code) {
        case GroundhogRpcErrorCode.BackendUnavailable:
        case GroundhogRpcErrorCode.ViewHeightUnavailable:
        case GroundhogRpcErrorCode.BackendTimeout:
        case GroundhogRpcErrorCode.Overloaded:
          return "transient";
        case GroundhogRpcErrorCode.InvalidParams:
        case GroundhogRpcErrorCode.TxInvalid:
        case GroundhogRpcErrorCode.TxRejected:
        case GroundhogRpcErrorCode.NotImplemented:
          return "permanent";
        default:
          return "unknown";
      }
    }
    if ("name" in error) {
      if (error.name === "TimeoutError") return "transient";
      if (error.name === "AbortError") return "cancelled";
    }
    // Do not unwrap contract/decoding errors into infrastructure retries.
    if (!(error instanceof Error) || error.constructor !== Error)
      return "unknown";
    error = error.cause;
  }
  return "unknown";
}
