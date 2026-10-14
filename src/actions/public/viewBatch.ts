import { toBase58 } from "../../encoding.js";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { ViewBatchRequest, ViewBatchResponse } from "../../types/rpc.js";
import { parseEmittedEvent } from "../emittedEvent.js";
import { toHex0x } from "../hex.js";
import {
  parseHeight,
  parseU64,
  serializeHeight,
  serializeU64,
} from "../decimal.js";
import { parseViewOutput } from "./view.js";
import { assertViewFreshness } from "../viewFreshness.js";
import { serializeViewAuthClaim } from "../viewAuthClaim.js";

/** Identifies a malformed per-call response without changing transport errors. */
export class ViewBatchResultError extends Error {
  override readonly name = "ViewBatchResultError";

  constructor(
    readonly index: number,
    cause: unknown,
  ) {
    super(`Failed to parse viewBatch result ${index}`, { cause });
  }
}

/**
 * Simulate independent calls at one committed height, in input order.
 * Requires groundhog_viewBatch (wire format 11.1.0). No fallback or chunking is used.
 * Each call may supply an optional authClaim (RPC wire 12.0.0); it is an
 * assumption for simulation, not verified authorization.
 * Simulated writes do not pass between calls. The server retries abandoned
 * snapshots as a whole group; aborts and faults remain per-call results.
 * Cancellation ends this client's wait, not necessarily backend execution.
 * The endpoint sets resource limits; inspect getServerLimits().viewBatch when needed.
 */
export async function viewBatch(
  transport: Transport,
  request: ViewBatchRequest,
  options?: TransportRequestOptions,
): Promise<ViewBatchResponse> {
  options?.signal?.throwIfAborted();
  if (request.calls.length === 0) {
    throw new RangeError("viewBatch requires at least one call");
  }
  const minHeight = request.minHeight;
  const serializedMinHeight =
    minHeight === undefined ? undefined : serializeHeight(minHeight);
  const calls = request.calls.map((call) => {
    if ("minHeight" in call) {
      throw new TypeError(
        "Set minHeight on the batch request, not on an individual call",
      );
    }
    if (call.gasLimit === 0n) throw new RangeError("gasLimit must be positive");
    if (call.entrypoint.length !== 8)
      throw new RangeError("view entrypoint must be exactly 8 bytes");
    return {
      contract: toBase58(call.contract),
      entrypoint: toHex0x(call.entrypoint),
      calldata: toHex0x(call.calldata),
      ...(call.caller ? { caller: toBase58(call.caller) } : {}),
      ...(call.authClaim === undefined
        ? {}
        : { authClaim: serializeViewAuthClaim(call.authClaim) }),
      ...(call.gasLimit === undefined
        ? {}
        : { gasLimit: serializeU64(call.gasLimit, "gasLimit") }),
    };
  });
  const raw = await transport.request<unknown>(
    "groundhog_viewBatch",
    [
      {
        calls,
        ...(serializedMinHeight === undefined
          ? {}
          : { minHeight: serializedMinHeight }),
      },
    ],
    options,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected viewBatch response to be an object");
  }
  const response = raw as Record<string, unknown>;
  const height = parseHeight(response.height);
  if (height < 0n) {
    throw new Error("viewBatch returned an invalid or stale height");
  }
  assertViewFreshness(height, minHeight);
  if (
    !Array.isArray(response.results) ||
    response.results.length !== calls.length
  ) {
    throw new Error("viewBatch result count does not match the request");
  }
  return {
    height,
    results: response.results.map((item: unknown, index: number) => {
      try {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("Expected a viewBatch call result object");
        }
        const result = item as Record<string, unknown>;
        if (!Array.isArray(result.events))
          throw new Error("Expected viewBatch events to be an array");
        return {
          output: parseViewOutput(result.output),
          gasUsed: parseU64(result.gasUsed, "gasUsed"),
          events: result.events.map(parseEmittedEvent),
        };
      } catch (cause) {
        throw new ViewBatchResultError(index, cause);
      }
    }),
  };
}
