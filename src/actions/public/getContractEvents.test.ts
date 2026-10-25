import { describe, expect, it, vi } from "vitest";
import { contractAddress, CxsWriter } from "@thruputchain/protocol";
import { thruput_erc20_if } from "../../contracts/index.js";
import { toBase58 } from "../../encoding.js";
import { toHex0x } from "../hex.js";
import { testRpc } from "../../testing/nativeRpc.js";
import { getContractEvents } from "./getContractEvents.js";
const event = thruput_erc20_if.v0_1.events.TransferEvent;
const token = contractAddress(new Uint8Array(32).fill(1)),
  sender = contractAddress(new Uint8Array(32).fill(2)),
  recipient = contractAddress(new Uint8Array(32).fill(3)),
  hash = new Uint8Array(32).fill(4);
const writer = new CxsWriter();
writer.writeInt128(42n);
const raw = {
  transactionHash: toBase58(hash),
  blockHeight: "43",
  sequenceNumber: 7,
  event: {
    address: toBase58(token),
    topics: [toHex0x(event.signature), toHex0x(sender), toHex0x(recipient)],
    data: toHex0x(writer.finish()),
  },
};
const page = {
  events: [raw],
  oldestIndexedBlockHeight: "5",
  latestIndexedBlockHeight: "50",
  nextCursor: "0x01",
};
const query = {
  event,
  addresses: [token],
  topics: { to: recipient },
  start: { order: "ascending", anchor: { kind: "atHeight", blockHeight: 42n } },
} as const;
describe("native typed token events", () => {
  it("queries incoming transfers with address/topic conversion and retains identity", async () => {
    const request = vi.fn().mockResolvedValue(page),
      client = await testRpc({ request });
    const result = await getContractEvents(client, {
      ...query,
      addresses: [token],
    });
    expect(result.events).toEqual([
      {
        name: "TransferEvent",
        topics: { from: sender, to: recipient },
        fields: { amount: 42n },
        address: token,
        transactionHash: hash,
        blockHeight: 43n,
        sequenceNumber: 7,
      },
    ]);
    expect(result.nextCursor).toBe("0x01");
    expect(request).toHaveBeenCalledWith(
      "getEvents",
      {
        filters: [
          {
            addresses: [toBase58(token)],
            topics: {
              topic0: [toHex0x(event.signature)],
              topic2: [toHex0x(recipient)],
            },
          },
        ],
        start: {
          order: "ascending",
          anchor: { kind: "atHeight", blockHeight: "42" },
        },
      },
      undefined,
    );
  });
  it("retains empty nonterminal pages and does not fetch another page", async () => {
    const request = vi.fn().mockResolvedValue({ ...page, events: [] }),
      client = await testRpc({ request });
    expect(
      await getContractEvents(client, { ...query, addresses: [token] }),
    ).toEqual({
      events: [],
      oldestIndexedBlockHeight: 5n,
      latestIndexedBlockHeight: 50n,
      nextCursor: "0x01",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong signature", "malformed payload", "wrong emitter"])(
    "rejects %s without silently dropping events",
    async (fault) => {
      const changed = structuredClone(raw);
      if (fault === "wrong signature")
        changed.event.topics[0] = toHex0x(new Uint8Array(32));
      if (fault === "malformed payload") changed.event.data = "0xff";
      if (fault === "wrong emitter") changed.event.address = toBase58(sender);
      const request = vi.fn().mockResolvedValue({ ...page, events: [changed] }),
        client = await testRpc({ request });
      await expect(
        getContractEvents(client, { ...query, addresses: [token] }),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("uses the same filter with an opaque continuation and preserves errors", async () => {
    const cause = Error("cursor rejected"),
      request = vi.fn().mockRejectedValue(cause),
      client = await testRpc({ request });
    await expect(
      getContractEvents(client, {
        event,
        addresses: [token],
        topics: { to: recipient },
        cursor: "0x01",
      }),
    ).rejects.toBe(cause);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
