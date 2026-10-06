import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { contractAddress, CxsWriter } from "@groundhogchain/protocol";
import { createGroundhogClient } from "../../client.js";
import { groundhog_erc20_if } from "../../contracts/index.js";
import { ContractDecodeError } from "../../contract/errors.js";
import { HttpTransport, JsonRpcError } from "../../transport/http.js";
import type { Transport } from "../../transport/types.js";
import { hashFromHex, toHex0x } from "../hex.js";
import { getContractEvents } from "./getContractEvents.js";

const { TransferEvent: ERC20TransferEvent } = groundhog_erc20_if.v0_1.events;
const token = contractAddress(new Uint8Array(32).fill(1));
const sender = contractAddress(new Uint8Array(32).fill(2));
const receiver = contractAddress(new Uint8Array(32).fill(3));
const hash = `0x${"04".repeat(32)}`;
const writer = new CxsWriter();
writer.writeInt128(42n);
const rawEvent = {
  txHash: hash,
  blockHeight: "43",
  sequenceNumber: 7,
  event: {
    contractAddress: toHex0x(token),
    topics: [
      toHex0x(ERC20TransferEvent.signature),
      toHex0x(sender),
      toHex0x(receiver),
    ],
    data: toHex0x(writer.finish()),
  },
};
const rawPage = {
  events: [rawEvent],
  cursor: "0x01",
  latestBlock: "50",
  oldestBlock: "5",
};
const query = {
  event: ERC20TransferEvent,
  contractAddresses: [token],
  topics: { to: receiver },
};

function transportFor(
  request: (...args: Parameters<Transport["request"]>) => Promise<unknown>,
): Transport {
  return {
    request: <T>(...args: Parameters<Transport["request"]>) =>
      request(...args) as Promise<T>,
  };
}

describe("getContractEvents", () => {
  it("makes one request and preserves decoded values, identity, and page metadata", async () => {
    const request = vi.fn<Transport["request"]>().mockResolvedValue(rawPage);
    const client = await createGroundhogClient({
      transport: transportFor(request),
    });
    const signal = new AbortController().signal;
    const page = await client.getContractEvents(
      {
        ...query,
        order: "descending",
        anchor: { height: 42n },
        cursor: new Uint8Array([4]),
        limit: 20,
      },
      { signal },
    );

    expect(request).toHaveBeenCalledExactlyOnceWith(
      "groundhog_getEvents",
      [
        {
          filters: [
            {
              contractAddresses: [toHex0x(token)],
              topics: {
                topic0: [toHex0x(ERC20TransferEvent.signature)],
                topic1: [],
                topic2: [toHex0x(receiver)],
              },
            },
          ],
          order: "descending",
          anchor: { kind: "atHeight", height: "42" },
          cursor: "0x04",
          limit: 20,
        },
      ],
      { signal },
    );
    expect(page).toEqual({
      events: [
        {
          name: "TransferEvent",
          topics: { from: sender, to: receiver },
          fields: { amount: 42n },
          contractAddress: token,
          txHash: hashFromHex(hash),
          blockHeight: 43n,
          sequenceNumber: 7,
        },
      ],
      cursor: new Uint8Array([1]),
      latestBlock: 50n,
      oldestBlock: 5n,
    });
    expectTypeOf(page.events[0]!.name).toEqualTypeOf<"TransferEvent">();
    expectTypeOf(page.events[0]!.fields.amount).toEqualTypeOf<bigint>();
    expectTypeOf(page.events[0]!.topics.to).toEqualTypeOf<typeof receiver>();
  });

  it("preserves an empty page's continuation cursor and retention bounds", async () => {
    const request = vi
      .fn<Transport["request"]>()
      .mockResolvedValue({ ...rawPage, events: [] });
    await expect(
      getContractEvents(transportFor(request), query),
    ).resolves.toEqual({
      events: [],
      cursor: new Uint8Array([1]),
      latestBlock: 50n,
      oldestBlock: 5n,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    {
      ...rawEvent.event,
      topics: [toHex0x(new Uint8Array(32)), toHex0x(sender), toHex0x(receiver)],
    },
    { ...rawEvent.event, data: "0x" },
    { ...rawEvent.event, data: `${rawEvent.event.data}00` },
    { ...rawEvent.event, topics: rawEvent.event.topics.slice(0, 2) },
  ])(
    "rejects unexpected or malformed events rather than dropping them",
    async (event) => {
      const request = vi
        .fn<Transport["request"]>()
        .mockResolvedValue({ ...rawPage, events: [{ ...rawEvent, event }] });
      await expect(
        getContractEvents(transportFor(request), query),
      ).rejects.toBeInstanceOf(ContractDecodeError);
    },
  );

  it("validates filters before sending a request", async () => {
    const request = vi.fn<Transport["request"]>();
    await expect(
      getContractEvents(transportFor(request), {
        ...query,
        contractAddresses: [],
      }),
    ).rejects.toThrow("requires a contract address");
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves cursor-rejection errors without retrying", async () => {
    const error = new JsonRpcError(-32602, "invalid cursor");
    const request = vi.fn<Transport["request"]>().mockRejectedValue(error);
    await expect(getContractEvents(transportFor(request), query)).rejects.toBe(
      error,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not dispatch a pre-aborted read", async () => {
    const reason = new Error("stopped");
    const request = vi.fn<Transport["request"]>();
    await expect(
      getContractEvents(transportFor(request), query, {
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(request).not.toHaveBeenCalled();
  });

  it("forwards in-flight cancellation through the client and HTTP transport", async () => {
    const controller = new AbortController();
    const transport = new HttpTransport("https://rpc.example", {
      fetch: async (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    });
    const client = await createGroundhogClient({ transport });
    const pending = client.getContractEvents(query, {
      signal: controller.signal,
    });
    const reason = new Error("page closed");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
