import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { ServerLimits } from "../../types/rpc.js";

/**
 * Return the request bounds configured on this endpoint. These may change when
 * the operator reconfigures the server and are separate from consensus limits.
 * Reject numeric bounds outside JavaScript's safe integer range.
 */
export async function getServerLimits(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<ServerLimits> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_serverLimits",
    undefined,
    options,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid server limits response");
  }
  const limits = result as Record<string, unknown>;
  const bound = (
    field: keyof ServerLimits,
    maximum = Number.MAX_SAFE_INTEGER,
  ): number => {
    const value = limits[field];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > maximum
    ) {
      throw new Error(
        `Invalid server limits response: expected unsigned safe integer ${field}`,
      );
    }
    return value;
  };
  return {
    maxViewGas: bound("maxViewGas"),
    maxViewCalldataBytes: bound("maxViewCalldataBytes"),
    maxEventsPerPage: bound("maxEventsPerPage", 0xffff_ffff),
    maxTransactionsPerPage: bound("maxTransactionsPerPage", 0xffff_ffff),
    maxCursorBytes: bound("maxCursorBytes"),
  };
}
