import type { Transport } from "../../transport/types.js";
import type {
  EventQuery,
  EventPage,
  EmittedEvent,
  IdentifiedEvent,
} from "../../types/rpc.js";
import { toHex0x, fromHex0x, hashFromHex, addressFromHex } from "../hex.js";

interface RawEmittedEvent {
  contractAddress: string;
  topics: string[];
  data: string;
}

interface RawIdentifiedEvent {
  txHash: string;
  blockHeight: number | string;
  sequenceNumber: number;
  event: unknown;
}

interface RawEventPage {
  events: unknown[];
  cursor: string;
  latestBlock: number | string;
  oldestBlock: number | string;
}

function serializeQuery(query: EventQuery): unknown {
  const anchor =
    query.anchor === "beginning"
      ? { kind: "atBeginning" }
      : query.anchor === "end"
        ? { kind: "atEnd" }
        : query.anchor
          ? { kind: "atHeight", height: Number(query.anchor.height) }
          : { kind: "atBeginning" };

  return {
    filters: query.filters.map((f) => ({
      contractAddresses: f.contractAddresses.map((a) => toHex0x(a)),
      topics: {
        topic0: (f.topics?.topic0 ?? []).map((t) => toHex0x(t)),
        topic1: (f.topics?.topic1 ?? []).map((t) => toHex0x(t)),
        topic2: (f.topics?.topic2 ?? []).map((t) => toHex0x(t)),
      },
    })),
    order: query.order ?? "ascending",
    anchor,
    cursor: query.cursor ? toHex0x(query.cursor) : "0x",
    limit: query.limit ?? 50,
  };
}

function parseEvent(e: unknown): EmittedEvent {
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    throw new Error("Invalid events response: expected event");
  }
  const event = e as RawEmittedEvent;

  if (!Array.isArray(event.topics)) {
    throw new Error("Invalid events response: expected event.topics");
  }

  return {
    contractAddress: addressFromHex(event.contractAddress),
    topics: event.topics.map(fromHex0x),
    data: fromHex0x(event.data),
  };
}

function parseIdentifiedEvent(value: unknown): IdentifiedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid events response: expected event entry");
  }
  const entry = value as RawIdentifiedEvent;

  if (typeof entry.sequenceNumber !== "number") {
    throw new Error("Invalid events response: expected sequenceNumber");
  }

  return {
    txHash: hashFromHex(entry.txHash),
    blockHeight: BigInt(entry.blockHeight),
    sequenceNumber: entry.sequenceNumber,
    event: parseEvent(entry.event),
  };
}

export async function getEvents(
  transport: Transport,
  query: EventQuery,
): Promise<EventPage> {
  const raw = await transport.request<unknown>("groundhog_getEvents", [
    serializeQuery(query),
  ]);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid events response");
  }
  const result = raw as RawEventPage;

  if (!Array.isArray(result.events)) {
    throw new Error("Invalid events response: expected events");
  }

  return {
    events: result.events.map(parseIdentifiedEvent),
    cursor: fromHex0x(result.cursor),
    latestBlock: BigInt(result.latestBlock),
    oldestBlock: BigInt(result.oldestBlock),
  };
}
