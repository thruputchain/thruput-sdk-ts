import type { RpcClient } from "../../rpc/client.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import type { EventPage, EventQuery } from "../../types/rpc.js";
import { walkHistory, type HistoryCompletion } from "./historyWalk.js";
export type EventWalkQuery = Extract<EventQuery, { start: unknown }>;
/** Start a fixed event range. Saved opaque cursors remain available through getEvents. */
export function iterateEventPages(
  client: Pick<RpcClient, "getEvents">,
  query: EventWalkQuery,
  options: TransportRequestOptions = {},
): AsyncGenerator<EventPage, HistoryCompletion, unknown> {
  const snapshot = structuredClone(query);
  if (!snapshot.start || snapshot.cursor !== undefined)
    throw new TypeError("Event walks require an explicit start");
  return walkHistory(
    (cursor) =>
      client.getEvents(
        cursor === undefined
          ? snapshot
          : { filters: snapshot.filters, limit: snapshot.limit, cursor },
        options,
      ),
    "events",
    { start: snapshot.start },
    options,
  ) as AsyncGenerator<EventPage, HistoryCompletion, unknown>;
}
