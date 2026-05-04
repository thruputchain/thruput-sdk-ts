import type { Transport } from "../../transport/types.js";
import type { EventQuery, EventPage, EmittedEvent } from "../../types/rpc.js";
import {
  toHex,
  fromHex,
  fromHex0x,
  hashFromHex,
  addressFromHex,
} from "../hex.js";

function serializeQuery(query: EventQuery): unknown {
  const anchor =
    query.anchor === "beginning"
      ? "AnchorAtBeginning"
      : query.anchor === "end"
        ? "AnchorAtEnd"
        : query.anchor
          ? { AnchorAtHeight: { height: Number(query.anchor.height) } }
          : "AnchorAtBeginning";

  const order = query.order === "descending" ? 1 : 0;

  return {
    filters: query.filters.map((f) => ({
      contract_addresses: f.contractAddresses.map((a) => toHex(a)),
      topics: {
        topic0: (f.topics?.topic0 ?? []).map((t) => toHex(t)),
        topic1: (f.topics?.topic1 ?? []).map((t) => toHex(t)),
        topic2: (f.topics?.topic2 ?? []).map((t) => toHex(t)),
      },
    })),
    order,
    anchor,
    cursor: query.cursor ? toHex(query.cursor) : "",
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
