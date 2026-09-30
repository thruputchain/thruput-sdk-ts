import { expect, it } from "vitest";
import {
  contractAddress,
  sha256Hash,
  type EventPage,
  type EventQuery,
  type IdentifiedEvent,
} from "../src/index.js";
import {
  scanEventHistory,
  type EventProgress,
  type EventStore,
} from "./event-history.js";

const address = contractAddress(new Uint8Array(32));
const query: EventQuery = {
  filters: [{ contractAddresses: [address] }],
  order: "ascending",
  anchor: { height: 10n },
  limit: 1,
};
function row(sequenceNumber: number, blockHeight = 10n): IdentifiedEvent {
  return {
    txHash: sha256Hash(new Uint8Array(32)),
    blockHeight,
    sequenceNumber,
    event: { contractAddress: address, topics: [], data: new Uint8Array() },
  };
}
function page(
  events: IdentifiedEvent[],
  cursor: number[],
  oldestBlock = 0n,
): EventPage {
  return {
    events,
    cursor: new Uint8Array(cursor),
    oldestBlock,
    latestBlock: 99n,
  };
}
class MemoryStore implements EventStore {
  progress: EventProgress | undefined;
  rows = new Map<number, IdentifiedEvent>(); // Fixture uses one transaction hash.
  failNext = false;
  async load() {
    return structuredClone(this.progress);
  }
  async savePage(rows: readonly IdentifiedEvent[], progress: EventProgress) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated database failure");
    }
    const next = new Map(this.rows);
    for (const row of rows) next.set(row.sequenceNumber, structuredClone(row));
    this.rows = next;
    this.progress = structuredClone(progress);
  }
}
function client(pages: EventPage[], requests: EventQuery[]) {
  return {
    async *iterateEventPages(request: EventQuery) {
      requests.push(structuredClone(request));
      for (const page of pages) yield page;
    },
  };
}

it("resumes a partial block, follows empty continuation pages, then rescans with deduplication", async () => {
  const store = new MemoryStore();
  const requests: EventQuery[] = [];
  await scanEventHistory(client([page([row(0)], [1])], requests), store, query);
  expect(store.progress?.resumeHeight).toBe(10n); // Never checkpoint latestBlock=99.
  await scanEventHistory(
    client([page([], [2]), page([row(1)], [])], requests),
    store,
    query,
  );
  expect(requests[1]?.cursor).toEqual(new Uint8Array([1]));
  expect(store.rows.size).toBe(2);
  await scanEventHistory(
    client([page([row(0), row(1), row(2, 11n)], [])], requests),
    store,
    query,
  );
  expect(requests[2]?.anchor).toEqual({ height: 10n });
  expect(requests[2]?.cursor).toHaveLength(0);
  expect(store.rows.size).toBe(3);
  expect(store.progress?.resumeHeight).toBe(11n);
});

it("does not advance progress when the atomic store operation fails", async () => {
  const store = new MemoryStore();
  const requests: EventQuery[] = [];
  await scanEventHistory(client([page([row(0)], [1])], requests), store, query);
  store.failNext = true;
  await expect(
    scanEventHistory(client([page([row(1)], [])], requests), store, query),
  ).rejects.toThrow("database failure");
  expect(store.progress?.query.cursor).toEqual(new Uint8Array([1]));
  expect(store.rows.size).toBe(1);
  await scanEventHistory(client([page([row(1)], [])], requests), store, query);
  expect(store.rows.size).toBe(2);
});

it("reports a retention gap without saving false completion", async () => {
  const store = new MemoryStore();
  await expect(
    scanEventHistory(client([page([], [], 11n)], []), store, query),
  ).rejects.toThrow("History gap");
  expect(store.progress).toBeUndefined();
});

it("can explicitly restart a partial block from its saved row height", async () => {
  const store = new MemoryStore();
  await scanEventHistory(client([page([row(0)], [1])], []), store, query);
  // Application/operator choice, not an automatic response to a cursor error.
  store.progress!.query = {
    ...store.progress!.query,
    anchor: { height: store.progress!.resumeHeight },
    cursor: new Uint8Array(),
  };
  await scanEventHistory(
    client([page([row(0)], [2]), page([row(1)], [])], []),
    store,
    query,
  );
  expect(store.rows.size).toBe(2);
  expect(store.progress?.complete).toBe(true);
});
