import type { Transport } from "../../transport/types.js";
import type {
  EmittedEvent,
  ViewOutput,
  ViewRequest,
  ViewResponse,
} from "../../types/rpc.js";
import { addressFromHex, fromHex0x, toHex0x } from "../hex.js";

function parseEvent(e: any): EmittedEvent {
  return {
    contractAddress: addressFromHex(e.contractAddress),
    topics: (e.topics ?? []).map((t: string) => fromHex0x(t)),
    data: e.data ? fromHex0x(e.data) : new Uint8Array(0),
  };
}

function parseOutput(raw: any): ViewOutput {
  switch (raw?.result) {
    case "return":
      return { result: "return", returnData: fromHex0x(raw.returnData) };
    case "abort":
      return { result: "abort", abortData: fromHex0x(raw.abortData) };
    case "fault":
      return { result: "fault" };
    default:
      throw new Error(`Unknown view output result: ${String(raw?.result)}`);
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

  const raw = await transport.request<any>("groundhog_view", [
    {
      contract: toHex0x(request.contract),
      entrypoint: toHex0x(request.entrypoint),
      calldata: toHex0x(request.calldata),
      ...(request.caller ? { caller: toHex0x(request.caller) } : {}),
    },
  ]);

  return {
    output: parseOutput(raw.output),
    events: (raw.events ?? []).map(parseEvent),
    height: BigInt(raw.height),
  };
}
