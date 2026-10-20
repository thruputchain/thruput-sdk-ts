import { describe, expect, it, vi } from "vitest";
import { iterateEventPages, type EventWalkQuery } from "./iterateEventPages.js";
import {
  iterateTransactionsByRootAddress,
  iterateTransactionsByBlock,
} from "./iterateTransactionPages.js";
import { HistoryWalkError } from "./historyWalk.js";
import type { EventPage, TransactionRefPage } from "../../types/rpc.js";
const address = new Uint8Array(32).fill(1);
const query: EventWalkQuery = {
  filters: [{ addresses: [address] }],
  start: { order: "ascending", anchor: { kind: "atBeginning" } },
};
const page = (nextCursor: string | null = null, height = 10n): EventPage => ({
  events: [],
  nextCursor,
  oldestIndexedBlockHeight: 0n,
  latestIndexedBlockHeight: height,
});
const event = (height: bigint, id: number) => ({
  blockHeight: height,
  transactionHash: new Uint8Array(32).fill(id),
  sequenceNumber: 0,
  event: { address, topics: [], data: new Uint8Array() },
});
describe("fixed native history walks", () => {
  it("yields empty continuation pages and returns completion only after processing terminal page", async () => {
    const getEvents = vi
      .fn()
      .mockResolvedValueOnce(page("0x01"))
      .mockResolvedValueOnce(page(null, 12n));
    const walk = iterateEventPages({ getEvents }, query);
    expect(getEvents).not.toHaveBeenCalled();
    expect((await walk.next()).done).toBe(false);
    expect(getEvents).toHaveBeenCalledTimes(1);
    expect((await walk.next()).done).toBe(false);
    expect(getEvents).toHaveBeenLastCalledWith(
      { filters: query.filters, limit: undefined, cursor: "0x01" },
      {},
    );
    expect(await walk.next()).toEqual({
      done: true,
      value: { watermarkBlockHeight: 10n, completedThroughBlockHeight: 10n },
    });
  });
  it("does not advance a checkpoint for an anchor above W or a descending walk", async () => {
    for (const start of [
      { order: "ascending", anchor: { kind: "atHeight", blockHeight: 11n } },
      { order: "descending", anchor: { kind: "atEnd" } },
    ] as const) {
      const walk = iterateEventPages(
        { getEvents: vi.fn().mockResolvedValue(page()) },
        { ...query, start },
      );
      await walk.next();
      expect(await walk.next()).toEqual({
        done: true,
        value: { watermarkBlockHeight: 10n },
      });
    }
  });
  it("snapshots query and continuation before mutable pages reach the caller", async () => {
    const input = structuredClone(query),
      getEvents = vi
        .fn()
        .mockResolvedValueOnce(page("0x01"))
        .mockResolvedValueOnce(page());
    const walk = iterateEventPages({ getEvents }, input);
    input.filters[0]!.addresses[0]!.fill(8);
    input.start = { order: "descending", anchor: { kind: "atEnd" } };
    const first = await walk.next();
    if (!first.done) first.value.nextCursor = "0xff";
    await walk.next();
    expect(getEvents.mock.calls[0]![0].start).toEqual(query.start);
    expect(getEvents.mock.calls[1]![0]).toMatchObject({
      cursor: "0x01",
      filters: query.filters,
    });
  });
  it("does not prefetch after the consumer breaks", async () => {
    const getEvents = vi.fn().mockResolvedValue(page("0x01"));
    for await (const _ of iterateEventPages({ getEvents }, query)) break;
    expect(getEvents).toHaveBeenCalledTimes(1);
  });
  it.each([
    "cycle",
    "regression",
    "retention",
    "beyond W",
    "duplicate",
    "order",
  ])("fails closed on %s without completing", async (fault) => {
    const first = { ...page("0x01"), events: [event(5n, 1)] };
    const second = { ...page(), events: [event(6n, 2)] };
    if (fault === "cycle") second.nextCursor = "0x01";
    if (fault === "regression") second.latestIndexedBlockHeight = 9n;
    if (fault === "retention") second.oldestIndexedBlockHeight = 1n;
    if (fault === "beyond W") {
      second.latestIndexedBlockHeight = 11n;
      second.events = [event(11n, 2)];
    }
    if (fault === "duplicate") second.events = [event(6n, 1)];
    if (fault === "order") second.events = [event(4n, 2)];
    const getEvents = vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      walk = iterateEventPages({ getEvents }, query);
    await walk.next();
    await expect(walk.next()).rejects.toBeInstanceOf(HistoryWalkError);
    expect(getEvents).toHaveBeenCalledTimes(2);
  });
  it("propagates errors and cancellation without retrying or starting a replacement walk", async () => {
    const cause = Error("invalid cursor"),
      getEvents = vi.fn().mockRejectedValue(cause);
    await expect(iterateEventPages({ getEvents }, query).next()).rejects.toBe(
      cause,
    );
    expect(getEvents).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort(cause);
    getEvents.mockClear();
    await expect(
      iterateEventPages({ getEvents }, query, {
        signal: controller.signal,
      }).next(),
    ).rejects.toBe(cause);
    expect(getEvents).not.toHaveBeenCalled();
  });
  it("does not expose a completed checkpoint after cancellation at the terminal page", async () => {
    const controller = new AbortController(),
      walk = iterateEventPages(
        { getEvents: vi.fn().mockResolvedValue(page()) },
        query,
        { signal: controller.signal },
      );
    await walk.next();
    controller.abort();
    await expect(walk.next()).rejects.toThrow();
  });
  it("keeps root-address scope and follows unsigned hash ordering", async () => {
    const first: TransactionRefPage = {
      ...page("0x01"),
      transactions: [
        { transactionHash: new Uint8Array(32).fill(1), blockHeight: 5n },
      ],
    };
    const second: TransactionRefPage = {
      ...page(),
      transactions: [
        { transactionHash: new Uint8Array(32).fill(2), blockHeight: 5n },
      ],
    };
    const getTransactionsByRootAddress = vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      walk = iterateTransactionsByRootAddress(
        { getTransactionsByRootAddress },
        { address, start: query.start },
      );
    await walk.next();
    await walk.next();
    expect(getTransactionsByRootAddress).toHaveBeenLastCalledWith(
      { address, limit: undefined, cursor: "0x01" },
      {},
    );
    expect((await walk.next()).value).toEqual({
      watermarkBlockHeight: 10n,
      completedThroughBlockHeight: 10n,
    });
  });
  it("exact-block walks require target coverage, not the initial unrelated tip", async () => {
    const first: TransactionRefPage = {
      transactions: [
        { transactionHash: new Uint8Array(32).fill(1), blockHeight: 5n },
      ],
      oldestIndexedBlockHeight: 1n,
      latestIndexedBlockHeight: 100n,
      nextCursor: "0x01",
    };
    const second = {
      ...first,
      transactions: [
        { transactionHash: new Uint8Array(32).fill(2), blockHeight: 5n },
      ],
      latestIndexedBlockHeight: 5n,
      nextCursor: null,
    };
    const getTransactionsByBlock = vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      walk = iterateTransactionsByBlock(
        { getTransactionsByBlock },
        { blockHeight: 5n, start: { order: "ascending" } },
      );
    await walk.next();
    await walk.next();
    expect(await walk.next()).toEqual({ done: true, value: undefined });
  });
  it("does not report exact-block completion when the target is outside coverage", async () => {
    const getTransactionsByBlock = vi.fn().mockResolvedValue({
      transactions: [],
      oldestIndexedBlockHeight: 1n,
      latestIndexedBlockHeight: 4n,
      nextCursor: null,
    });
    await expect(
      iterateTransactionsByBlock(
        { getTransactionsByBlock },
        { blockHeight: 5n, start: { order: "ascending" } },
      ).next(),
    ).rejects.toThrow("outside current indexed coverage");
  });
  it("requires an explicit start instead of inventing an opaque cursor's watermark", () => {
    expect(() =>
      iterateEventPages({ getEvents: vi.fn() }, {
        filters: query.filters,
        cursor: "0x01",
      } as never),
    ).toThrow("explicit start");
  });
});

it.each(["ascending", "descending"] as const)(
  "retains explicit %s anchor through empty continuation pages",
  async (order) => {
    const getEvents = vi
      .fn()
      .mockResolvedValueOnce(page("0x01"))
      .mockResolvedValueOnce({
        ...page(),
        events: [event(order === "ascending" ? 4n : 6n, 2)],
      });
    const walk = iterateEventPages(
      { getEvents },
      {
        ...query,
        start: { order, anchor: { kind: "atHeight", blockHeight: 5n } },
      },
    );
    await walk.next();
    await expect(walk.next()).rejects.toThrow("fixed walk scope");
  },
);
it("detects retention loss below a descending anchor", async () => {
  const getEvents = vi
    .fn()
    .mockResolvedValueOnce(page("0x01"))
    .mockResolvedValueOnce({ ...page(), oldestIndexedBlockHeight: 4n });
  const walk = iterateEventPages(
    { getEvents },
    {
      ...query,
      start: {
        order: "descending",
        anchor: { kind: "atHeight", blockHeight: 5n },
      },
    },
  );
  await walk.next();
  await expect(walk.next()).rejects.toThrow("retention");
});
