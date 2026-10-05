import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { ViewBatchRequest, ViewBatchResponse } from "../../types/rpc.js";
import { parseEmittedEvent } from "../emittedEvent.js";
import { toHex0x } from "../hex.js";
import { parseGasUsed, parseViewOutput } from "./view.js";

/**
 * Simulate 1–16 independent calls at one committed height, in input order.
 * Requires groundhog_viewBatch (wire format 8.2.0). No fallback or chunking is used.
 * Simulated writes do not pass between calls. The server retries abandoned
 * snapshots as a whole group; aborts and faults remain per-call results.
 * Cancellation ends this client's wait, not necessarily backend execution.
 */
export async function viewBatch(
  transport: Transport,
  request: ViewBatchRequest,
  options?: TransportRequestOptions,
): Promise<ViewBatchResponse> {
  options?.signal?.throwIfAborted();
  if (request.calls.length < 1 || request.calls.length > 16) {
    throw new RangeError("viewBatch requires between 1 and 16 calls");
  }
  const minHeight = request.minHeight;
  if (
    minHeight !== undefined &&
    (typeof minHeight !== "bigint" ||
      minHeight < 0n ||
      minHeight > BigInt(Number.MAX_SAFE_INTEGER))
  ) {
    throw new RangeError("minHeight must be a non-negative safe integer");
  }
  let remaining = 65_536;
  const calls = request.calls.map((call) => {
    if (call.entrypoint.length !== 8)
      throw new RangeError("view entrypoint must be exactly 8 bytes");
    if (call.calldata.length > remaining)
      throw new RangeError("viewBatch calldata exceeds 64 KiB");
    remaining -= call.calldata.length;
    return {
      contract: toHex0x(call.contract),
      entrypoint: toHex0x(call.entrypoint),
      calldata: toHex0x(call.calldata),
      ...(call.caller ? { caller: toHex0x(call.caller) } : {}),
    };
  });
  const raw = await transport.request<unknown>(
    "groundhog_viewBatch",
    [
      {
        calls,
        ...(minHeight === undefined ? {} : { minHeight: Number(minHeight) }),
      },
    ],
    options,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected viewBatch response to be an object");
  }
  const response = raw as Record<string, unknown>;
  const rawHeight = response.height;
  if (
    !(
      typeof rawHeight === "number" &&
      Number.isSafeInteger(rawHeight) &&
      rawHeight >= 0
    ) &&
    !(typeof rawHeight === "string" && /^(0|[1-9][0-9]*)$/.test(rawHeight))
  ) {
    throw new Error("Expected a non-negative integer viewBatch height");
  }
  const height = BigInt(rawHeight);
  if (
    height > 0x7fff_ffff_ffff_ffffn ||
    (minHeight !== undefined && height < minHeight)
  ) {
    throw new Error("viewBatch returned an invalid or stale height");
  }
  if (
    !Array.isArray(response.results) ||
    response.results.length !== calls.length
  ) {
    throw new Error("viewBatch result count does not match the request");
  }
  return {
    height,
    results: response.results.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Expected a viewBatch call result object");
      }
      const result = item as Record<string, unknown>;
      if (!Array.isArray(result.events))
        throw new Error("Expected viewBatch events to be an array");
      return {
        output: parseViewOutput(result.output),
        gasUsed: parseGasUsed(result.gasUsed),
        events: result.events.map(parseEmittedEvent),
      };
    }),
  };
}
