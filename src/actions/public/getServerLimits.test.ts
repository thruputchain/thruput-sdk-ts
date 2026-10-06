import { describe, expect, it, vi } from "vitest";
import { getServerLimits } from "../../index.js";
import { createGroundhogClient } from "../../client.js";
import { MockTransport } from "../../transport/mock.js";
import type { Transport } from "../../transport/types.js";

const limits = {
  maxViewGas: "100000000",
  maxViewCalldataBytes: "65536",
  maxEventsPerPage: 200,
  maxTransactionsPerPage: 200,
  maxCursorBytes: "1024",
};
function returning(result: unknown): Transport {
  return { request: async <T>() => result as T };
}

describe("getServerLimits", () => {
  it("binds the action on the client and exposes the standalone action", async () => {
    const client = await createGroundhogClient({
      transport: new MockTransport(),
    });
    const expected = {
      ...limits,
      maxViewGas: 100_000_000n,
      maxViewCalldataBytes: 65_536n,
      maxCursorBytes: 1024n,
    };
    await expect(client.getServerLimits()).resolves.toEqual(expected);
    await expect(getServerLimits(returning(limits))).resolves.toEqual(expected);
  });

  it("preserves zero and the full u64 range", async () => {
    const response = {
      ...limits,
      maxViewGas: "18446744073709551615",
      maxEventsPerPage: 0xffff_ffff,
      maxCursorBytes: "0",
    };
    await expect(getServerLimits(returning(response))).resolves.toEqual({
      ...response,
      maxViewGas: 18446744073709551615n,
      maxViewCalldataBytes: 65_536n,
      maxCursorBytes: 0n,
    });
  });

  it.each([
    null,
    [],
    1,
    {},
    { ...limits, maxViewGas: 1 },
    { ...limits, maxViewGas: "18446744073709551616" },
    { ...limits, maxViewGas: "01" },
    { ...limits, maxViewGas: Number.MAX_SAFE_INTEGER + 1 },
    { ...limits, maxCursorBytes: -1 },
    { ...limits, maxViewCalldataBytes: 0.5 },
    { ...limits, maxEventsPerPage: 2 ** 32 },
    { ...limits, maxTransactionsPerPage: 2 ** 32 },
  ])("rejects malformed bounds %j", async (result) => {
    await expect(getServerLimits(returning(result))).rejects.toThrow("Invalid");
  });

  it("forwards cancellation and avoids requests after cancellation", async () => {
    const transport = returning(limits);
    const request = vi.spyOn(transport, "request");
    const controller = new AbortController();
    const options = { signal: controller.signal };
    await getServerLimits(transport, options);
    expect(request).toHaveBeenCalledWith(
      "groundhog_serverLimits",
      undefined,
      options,
    );
    controller.abort();
    await expect(getServerLimits(transport, options)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
