import type { Transport } from "../../transport/types.js";
import type { EventQuery, EventPage, EmittedEvent } from "../../types/rpc.js";
import {
  toHex0x,
  fromHex,
  fromHex0x,
  hashFromHex,
  addressFromHex,
} from "../hex.js";

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

function parseEvent(e: any): EmittedEvent {
  return {
    contractAddress: addressFromHex(e.contractAddress),
    topics: (e.topics ?? []).map((t: string) => fromHex0x(t)),
    data: e.data ? fromHex0x(e.data) : new Uint8Array(0),
  };
}

export async function getEvents(
  transport: Transport,
  query: EventQuery,
): Promise<EventPage> {
  const raw = await transport.request<any>("groundhog_getEvents", [
    serializeQuery(query),
  ]);
  return {
    events: (raw.events ?? []).map((ie: any) => ({
      txHash: hashFromHex(ie.txHash),
      blockHeight: BigInt(ie.blockHeight),
      sequenceNumber: Number(ie.sequenceNumber),
      event: parseEvent(ie.event),
    })),
    cursor: raw.cursor ? fromHex(raw.cursor) : new Uint8Array(0),
    latestBlock: BigInt(raw.latestBlock),
    oldestBlock: BigInt(raw.oldestBlock),
  };
}
