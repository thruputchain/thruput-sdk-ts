import type { Transport } from "../../transport/types.js";
import type {
  EmittedEvent,
  ViewOutput,
  ViewRequest,
  ViewResponse,
} from "../../types/rpc.js";
import { addressFromHex, fromHex0x, toHex0x } from "../hex.js";

function parseEvent(value: unknown): EmittedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected view event to be an object");
  }

  const e = value as Record<string, unknown>;
  if (typeof e.contractAddress !== "string") {
    throw new Error("Expected view event contractAddress to be a string");
  }

  const topics = e.topics ?? [];
  if (!Array.isArray(topics)) {
    throw new Error("Expected view event topics to be an array");
  }

  const data = e.data ?? "0x";
  if (typeof data !== "string") {
    throw new Error("Expected view event data to be a string");
  }

  return {
    contractAddress: addressFromHex(e.contractAddress),
    topics: topics.map((topic) => {
      if (typeof topic !== "string") {
        throw new Error("Expected view event topic to be a string");
      }
      return fromHex0x(topic);
    }),
    data: fromHex0x(data),
  };
}

function parseOutput(value: unknown): ViewOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected view output to be an object");
  }

  const raw = value as Record<string, unknown>;
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

export async function view(
  transport: Transport,
  request: ViewRequest,
): Promise<ViewResponse> {
  if (request.entrypoint.length !== 8) {
    throw new Error(
      `view: entrypoint must be exactly 8 bytes, got ${request.entrypoint.length}`,
    );
  }

  const raw = await transport.request<unknown>("groundhog_view", [
    {
      contract: toHex0x(request.contract),
      entrypoint: toHex0x(request.entrypoint),
      calldata: toHex0x(request.calldata),
      ...(request.caller ? { caller: toHex0x(request.caller) } : {}),
    },
  ]);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Expected view response to be an object");
  }

  const response = raw as Record<string, unknown>;
  const events = response.events ?? [];
  if (!Array.isArray(events)) {
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
    events: events.map(parseEvent),
    height: BigInt(response.height),
  };
}
