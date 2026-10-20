import type { TransportRequestOptions } from "../../transport/types.js";
import type {
  EventPage,
  TransactionRefPage,
  IterationOrder,
  HistoryStart,
} from "../../types/rpc.js";
import { toHex0x } from "../hex.js";

/** Returned only after the caller resumes past the terminal page. Persist with processed data. */
export interface HistoryCompletion {
  readonly watermarkBlockHeight: bigint;
  /** Ascending range fully consumed; absent for descending or an anchor above the watermark. */
  readonly completedThroughBlockHeight?: bigint;
}
export class HistoryWalkError extends Error {
  constructor(
    message: string,
    readonly page: EventPage | TransactionRefPage,
  ) {
    super(message);
    this.name = "HistoryWalkError";
  }
}
type Key = readonly [bigint, string, number];
const compare = (a: Key, b: Key) => {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
};
/** Shared cross-page checks; single-page shape, filter and identity checks belong to RpcClient. */
export async function* walkHistory<P extends EventPage | TransactionRefPage>(
  fetch: (cursor: string | undefined) => Promise<P>,
  kind: "events" | "transactions",
  scope:
    | { start: HistoryStart }
    | { blockHeight: bigint; order: IterationOrder },
  options: TransportRequestOptions,
): AsyncGenerator<P, HistoryCompletion | void, unknown> {
  const order = "start" in scope ? scope.start.order : scope.order;
  let cursor: string | undefined,
    watermark: bigint | undefined,
    lowerBound: bigint | undefined,
    upperBound: bigint | undefined,
    last: Key | undefined;
  const cursors = new Set<string>(),
    identities = new Set<string>();
  for (;;) {
    options.signal?.throwIfAborted();
    const page = await fetch(cursor);
    options.signal?.throwIfAborted();
    const fail = (message: string): never => {
      throw new HistoryWalkError(message, page);
    };
    const rows =
      kind === "events"
        ? (page as EventPage).events
        : (page as TransactionRefPage).transactions;
    if (watermark === undefined) {
      watermark = page.latestIndexedBlockHeight;
      lowerBound =
        "start" in scope &&
        order === "ascending" &&
        scope.start.anchor.kind === "atHeight"
          ? scope.start.anchor.blockHeight
          : page.oldestIndexedBlockHeight;
      upperBound =
        "start" in scope &&
        order === "descending" &&
        scope.start.anchor.kind === "atHeight" &&
        scope.start.anchor.blockHeight < watermark
          ? scope.start.anchor.blockHeight
          : watermark;
    }
    if ("blockHeight" in scope) {
      if (
        scope.blockHeight < page.oldestIndexedBlockHeight ||
        scope.blockHeight > page.latestIndexedBlockHeight
      )
        fail("Requested block is outside current indexed coverage");
    } else {
      if (page.latestIndexedBlockHeight < watermark)
        fail("History coverage regressed below the initial watermark");
      if (page.oldestIndexedBlockHeight > lowerBound!)
        fail("History retention no longer covers the requested range");
    }
    for (const row of rows) {
      if (
        "blockHeight" in scope
          ? row.blockHeight !== scope.blockHeight
          : row.blockHeight > upperBound! || row.blockHeight < lowerBound!
      )
        fail("History row is outside the fixed walk scope");
      const hash = toHex0x(row.transactionHash),
        sequence =
          kind === "events"
            ? (row as EventPage["events"][number]).sequenceNumber
            : 0;
      const identity = kind === "events" ? `${hash}/${sequence}` : hash;
      if (identities.has(identity))
        fail("History returned a duplicate identity across pages");
      const key: Key = [row.blockHeight, hash, sequence];
      if (
        last &&
        (order === "ascending"
          ? compare(last, key) >= 0
          : compare(last, key) <= 0)
      )
        fail("History order did not advance across pages");
      identities.add(identity);
      last = key;
    }
    // Capture cursor before the caller can mutate the yielded page.
    const next = page.nextCursor;
    if (next !== null) {
      if (cursors.has(next))
        fail("History returned a repeated pagination cursor");
      cursors.add(next);
    }
    yield page;
    if (next === null) {
      options.signal?.throwIfAborted();
      if ("blockHeight" in scope) return;
      return {
        watermarkBlockHeight: watermark,
        ...(order === "ascending" && lowerBound! <= watermark
          ? { completedThroughBlockHeight: watermark }
          : {}),
      };
    }
    cursor = next;
  }
}
