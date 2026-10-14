import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { ViewOutput, ViewRequest, ViewResponse } from "../../types/rpc.js";
import { parseEmittedEvent } from "../emittedEvent.js";
import { fromHex0x, toHex0x } from "../hex.js";
import {
  parseHeight,
  parseU64,
  serializeHeight,
  serializeU64,
} from "../decimal.js";
import { assertViewFreshness } from "../viewFreshness.js";
import { serializeViewAuthClaim } from "../viewAuthClaim.js";

interface RawViewOutput {
  result: string;
  returnData: string;
  abortData: string;
}

interface RawViewResponse {
  output: unknown;
  events: unknown;
  height: string;
  gasUsed: unknown;
}

export function parseViewOutput(value: unknown): ViewOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected view output to be an object");
  }

  const raw = value as RawViewOutput;
  switch (raw.result) {
    case "return":
      if (typeof raw.returnData !== "string") {
        throw new Error("Expected view returnData to be a string");
      }
      return {
        result: "return",
        returnData: fromHex0x(raw.returnData),
      };
    case "abort":
      if (typeof raw.abortData !== "string") {
        throw new Error("Expected view abortData to be a string");
      }
      return {
        result: "abort",
        abortData: fromHex0x(raw.abortData),
      };
    case "fault":
      return { result: "fault" };
    default:
      throw new Error(`Unknown view output result: ${String(raw.result)}`);
  }
}

/**
 * Execute a read-only contract invocation without submitting a transaction.
 *
 * `view` is useful for local reads and UI queries. The invocation is evaluated
 * by the gateway and does not enter the mempool.
 * Optional `authClaim` assumes authorization without signatures (RPC wire 12.0.0).
 * Contracts still run their normal checks.
 * `minHeight` requires the actual committed snapshot to be at least that height.
 * A lagging server returns ViewHeightUnavailable; this action never polls or retries.
 *
 * @example
 * ```ts
 * const response = await view(transport, {
 *   contract,
 *   entrypoint,
 *   calldata,
 *   caller,
 * });
 *
 * if (response.output.result === "return") {
 *   console.log(response.output.returnData);
 * }
 * ```
 */
export async function view(
  transport: Transport,
  request: ViewRequest,
  options?: TransportRequestOptions,
): Promise<ViewResponse> {
  options?.signal?.throwIfAborted();
  const minHeight = request.minHeight;
  const serializedMinHeight =
    minHeight === undefined ? undefined : serializeHeight(minHeight);
  if (request.gasLimit === 0n) {
    throw new RangeError("gasLimit must be positive");
  }
  if (request.entrypoint.length !== 8) {
    throw new Error(
      `view: entrypoint must be exactly 8 bytes, got ${request.entrypoint.length}`,
    );
  }

  const raw = await transport.request<unknown>(
    "groundhog_view",
    [
      {
        contract: toHex0x(request.contract),
        entrypoint: toHex0x(request.entrypoint),
        calldata: toHex0x(request.calldata),
        ...(request.caller ? { caller: toHex0x(request.caller) } : {}),
        ...(request.authClaim === undefined
          ? {}
          : { authClaim: serializeViewAuthClaim(request.authClaim) }),
        ...(request.gasLimit === undefined
          ? {}
          : { gasLimit: serializeU64(request.gasLimit, "gasLimit") }),
        ...(serializedMinHeight === undefined
          ? {}
          : { minHeight: serializedMinHeight }),
      },
    ],
    options,
  );

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected view response to be an object");
  }

  const response = raw as RawViewResponse;
  const height = parseHeight(response.height);
  assertViewFreshness(height, minHeight);
  if (!Array.isArray(response.events)) {
    throw new Error("Expected view response events to be an array");
  }

  return {
    output: parseViewOutput(response.output),
    events: response.events.map(parseEmittedEvent),
    height,
    gasUsed: parseU64(response.gasUsed, "gasUsed"),
  };
}
