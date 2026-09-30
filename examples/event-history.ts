// Application-owned ingestion example. It adds no persistence API to the SDK.
import type {
  CoreGroundhogClient,
  EventQuery,
  IdentifiedEvent,
} from "../src/index.js";

export interface EventProgress {
  query: EventQuery;
  resumeHeight: bigint;
  complete: boolean;
}

/** One store per network and query. Implement savePage as a database transaction. */
export interface EventStore {
  load(): Promise<EventProgress | undefined>;
  /** Upsert by (txHash, sequenceNumber) and save progress in the SAME transaction. */
  savePage(
    rows: readonly IdentifiedEvent[],
    progress: EventProgress,
  ): Promise<void>;
}

/** Complete one historical walk. initialQuery is used only for an empty store. */
export async function scanEventHistory(
  client: Pick<CoreGroundhogClient, "iterateEventPages">,
  store: EventStore,
  initialQuery: EventQuery,
  signal?: AbortSignal,
): Promise<void> {
  const saved = await store.load();
  const query = structuredClone(saved?.query ?? initialQuery);
  if (query.order !== "ascending" || query.anchor === "end") {
    throw new Error(
      "Use an ascending history query starting at beginning or a height",
    );
  }
  let resumeHeight =
    saved?.resumeHeight ??
    (typeof query.anchor === "object" ? query.anchor.height : 0n);
  if (saved?.complete) {
    query.anchor = { height: resumeHeight };
    query.cursor = new Uint8Array();
  }
  for await (const page of client.iterateEventPages(query, { signal })) {
    if (page.oldestBlock > resumeHeight) {
      throw new Error(
        "History gap: the indexer no longer covers the saved starting height",
      );
    }
    const last = page.events.at(-1);
    if (last) resumeHeight = last.blockHeight;
    const progress: EventProgress = {
      query: { ...query, cursor: page.cursor.slice() },
      resumeHeight,
      complete: page.cursor.length === 0,
    };
    // Capture progress before giving the application any mutable event objects.
    await store.savePage(page.events, structuredClone(progress));
  }
}
