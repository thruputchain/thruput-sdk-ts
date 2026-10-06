import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  EventQuery,
  EventPage,
  IdentifiedEvent,
} from "../../types/rpc.js";
import { parseEmittedEvent } from "../emittedEvent.js";
import { toHex0x, fromHex0x, hashFromHex } from "../hex.js";
import { parseHeight, serializeHeight } from "../decimal.js";

interface RawIdentifiedEvent {
  txHash: string;
  blockHeight: string;
  sequenceNumber: number;
  event: unknown;
}

interface RawEventPage {
  events: unknown[];
  cursor: string;
  latestBlock: string;
  oldestBlock: string;
}

function serializeQuery(query: EventQuery): unknown {
  const anchor =
    query.anchor === "beginning"
      ? { kind: "atBeginning" }
      : query.anchor === "end"
        ? { kind: "atEnd" }
        : query.anchor
          ? { kind: "atHeight", height: serializeHeight(query.anchor.height) }
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
    blockHeight: parseHeight(entry.blockHeight, "blockHeight"),
    sequenceNumber: entry.sequenceNumber,
    event: parseEmittedEvent(entry.event),
  };
}

/**
 * Query emitted contract events with the gateway's paginated event API.
 *
 * Use `cursor` from the returned page to request the next page with the same
 * filters and ordering. The query needs at least one filter, and each filter
 * at least one contract address.
 * An empty cursor ends this historical walk; an empty events array alone does not.
 * A cursor does not follow later blocks. For ascending ingestion, start a new
 * ascending walk with an empty cursor at the last stored row's height. Deduplicate
 * by transaction hash and event sequence number. Refresh descending history from
 * anchor "end" with an empty cursor, not the last (oldest) row.
 * Save rows and progress together. latestBlock is not an application checkpoint.
 * Raw RPC callers must include order and anchor even on continuation; this action
 * supplies defaults. Cursor validity and history retention remain backend concerns.
 *
 * @example
 * ```ts
 * const page = await getEvents(transport, {
 *   filters: [{ contractAddresses: [contractAddress] }],
 *   order: "ascending",
 *   limit: 25,
 * });
 * ```
 */
export async function getEvents(
  transport: Transport,
  query: EventQuery,
  options?: TransportRequestOptions,
): Promise<EventPage> {
  options?.signal?.throwIfAborted();
  if (query.filters.length === 0) {
    throw new RangeError("getEvents requires at least one filter");
  }
  if (query.filters.some((filter) => filter.contractAddresses.length === 0)) {
    throw new RangeError(
      "getEvents requires at least one contract address in every filter",
    );
  }
  const raw = await transport.request<unknown>(
    "groundhog_getEvents",
    [serializeQuery(query)],
    options,
  );
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
    latestBlock: parseHeight(result.latestBlock, "latestBlock"),
    oldestBlock: parseHeight(result.oldestBlock, "oldestBlock"),
  };
}
