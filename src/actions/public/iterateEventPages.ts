import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { EventPage, EventQuery } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";
import { getEvents } from "./getEvents.js";

/**
 * Fetch event pages on demand until the RPC returns an empty cursor.
 *
 * Snapshots the query when called and requests one page at a time. There is no
 * prefetching, polling, or automatic retry. Empty pages with continuation cursors
 * are yielded and followed. Repeated cursors throw instead of looping forever.
 * Breaking the loop stops further requests; use signal to cancel an in-flight read.
 *
 * Page bounds describe the indexer, not a durable application checkpoint. The
 * caller owns persistence, retention checks, and recovery from rejected cursors.
 * The cursor bounds a historical walk; it does not subscribe to later blocks.
 * Response-time indexer bounds can change while the walk continues. For ascending
 * ingestion, start a new ascending walk with an empty cursor at the last stored
 * row's height and deduplicate that block. Refresh descending history from
 * anchor "end" with an empty cursor, not its last (oldest) row.
 *
 * @example
 * ```ts
 * for await (const page of iterateEventPages(transport, query, { signal })) {
 *   await processPage(page);
 *   if (shouldPause()) break;
 * }
 * ```
 */
export function iterateEventPages(
  transport: Transport,
  query: EventQuery,
  options: TransportRequestOptions = {},
): AsyncGenerator<EventPage, void, unknown> {
  const snapshot = structuredClone(query);
  const { signal } = options;
  return (async function* () {
    let cursor = snapshot.cursor;
    const seen = new Set<string>();
    if (cursor?.length) seen.add(toHex0x(cursor));

    for (;;) {
      signal?.throwIfAborted();
      const page = await getEvents(
        transport,
        { ...snapshot, cursor },
        { signal },
      );
      signal?.throwIfAborted();
      // Capture continuation before yielding mutable page data to the caller.
      const nextCursor = page.cursor.slice();
      if (nextCursor.length > 0) {
        const key = toHex0x(nextCursor);
        if (seen.has(key))
          throw new Error("Event query returned a repeated pagination cursor");
        seen.add(key);
      }
      yield page;
      if (nextCursor.length === 0) return;
      cursor = nextCursor;
    }
  })();
}
