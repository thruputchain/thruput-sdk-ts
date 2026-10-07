import { describe, expect, it } from "vitest";
import { getBlockByNumber } from "./public/getBlockByNumber.js";
import { getChainTip } from "./public/getChainTip.js";
import { getEvents } from "./public/getEvents.js";
import { getTransactionsByAddress } from "./public/getTransactionsByAddress.js";
import { view } from "./public/view.js";
import {
  contractAddress,
  contractEntrypointID,
  calldata,
} from "@groundhogchain/protocol";
import type { Transport } from "../transport/types.js";
import { I64_MIN, I64_MAX, U64_MAX, parseHeight, parseU64 } from "./decimal.js";

describe("wide integer JSON boundaries", () => {
  it.each([0n, -1n, 1n << 64n, 42 as unknown as bigint])(
    "rejects invalid view gas %s before sending a request",
    async (gasLimit) => {
      let called = false;
      const transport: Transport = {
        async request<T>() {
          called = true;
          return null as T;
        },
      };
      await expect(
        view(transport, {
          contract: contractAddress(new Uint8Array(32)),
          entrypoint: contractEntrypointID(new Uint8Array(8)),
          calldata: calldata(new Uint8Array()),
          gasLimit,
        }),
      ).rejects.toThrow(RangeError);
      expect(called).toBe(false);
    },
  );
  it.each([0n, (1n << 53n) - 1n, 1n << 53n, (1n << 53n) + 1n, I64_MAX])(
    "preserves height %s through JSON request and response encoding",
    async (height) => {
      const address = contractAddress(new Uint8Array(32));
      const hash = "0x" + "00".repeat(32);
      const transport: Transport = {
        async request<T>(method: string, params?: unknown[]): Promise<T> {
          const wire = JSON.parse(JSON.stringify(params ?? []));
          if (method === "groundhog_getBlockByNumber") {
            expect(wire).toEqual([height.toString()]);
            return null as T;
          }
          if (method === "groundhog_chainTip") {
            return JSON.parse(
              JSON.stringify({ height: height.toString(), blockHash: hash }),
            ) as T;
          }
          expect(wire[0].anchor).toEqual({
            kind: "atHeight",
            height: height.toString(),
          });
          return JSON.parse(
            JSON.stringify({
              events: [],
              refs: [],
              cursor: "0x",
              latestBlock: height.toString(),
              oldestBlock: "0",
            }),
          ) as T;
        },
      };
      await getBlockByNumber(transport, height);
      expect((await getChainTip(transport)).height).toBe(height);
      expect(
        (
          await getEvents(transport, {
            filters: [{ contractAddresses: [address] }],
            anchor: { height },
          })
        ).latestBlock,
      ).toBe(height);
      expect(
        (
          await getTransactionsByAddress(transport, {
            address,
            anchor: { height },
          })
        ).latestBlock,
      ).toBe(height);
    },
  );

  it("preserves signed boundaries and nanosecond timestamps", () => {
    expect(parseHeight(I64_MIN.toString())).toBe(I64_MIN);
    expect(parseHeight(I64_MAX.toString())).toBe(I64_MAX);
    expect(parseU64("1791200000000000001", "timepoint")).toBe(
      1791200000000000001n,
    );
    expect(parseU64(U64_MAX.toString(), "gas")).toBe(U64_MAX);
  });

  it.each([
    0,
    42,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    true,
    "",
    "00",
    "01",
    "+1",
    "-0",
    " 1",
    "1 ",
    "1\n",
    "1\r\n",
    "1e3",
    "0x10",
    "1.0",
    "18446744073709551616",
  ])("rejects noncanonical or overflowing u64 %s", (value) =>
    expect(() => parseU64(value, "gas")).toThrow(),
  );

  it.each(["9223372036854775808", "-9223372036854775809"])(
    "rejects out-of-range int64 %s",
    (value) => expect(() => parseHeight(value)).toThrow(),
  );
});
