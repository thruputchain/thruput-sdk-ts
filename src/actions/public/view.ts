import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { ViewOutput, ViewRequest, ViewResponse } from "../../types/rpc.js";
import { parseEmittedEvent } from "../emittedEvent.js";
import { fromHex0x, toHex0x } from "../hex.js";

interface RawViewOutput {
  result: string;
  returnData: string;
  abortData: string;
}

interface RawViewResponse {
  output: unknown;
  events: unknown;
  height: number | string;
  gasUsed: unknown;
}

function parseGasUsed(value: unknown): bigint {
  let parsed: bigint | undefined;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = BigInt(value);
  }
  if (parsed === undefined || parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) {
    throw new Error("Invalid view response: expected gasUsed to be a u64");
  }
  return parsed;
}

function parseOutput(value: unknown): ViewOutput {
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
      },
    ],
    options,
  );

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected view response to be an object");
  }

  const response = raw as RawViewResponse;
  if (!Array.isArray(response.events)) {
    throw new Error("Expected view response events to be an array");
  }

  if (
    typeof response.height !== "string" &&
    typeof response.height !== "number"
  ) {
    throw new Error("Expected view height to be a string or number");
  }

  return {
    output: parseOutput(response.output),
    events: response.events.map(parseEmittedEvent),
    height: BigInt(response.height),
    gasUsed: parseGasUsed(response.gasUsed),
  };
}
