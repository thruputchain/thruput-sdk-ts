import { describe, expect, it, vi } from "vitest";
import { contractAddress } from "@thruputchain/protocol";
import { CxsWriter } from "@thruputchain/xdr";
import { ERC20 } from "../../contracts/index.js";
import { testRpc } from "../../testing/nativeRpc.js";
import { UnsupportedRpcValue } from "../../rpc/codec.js";
import { toHex0x } from "../hex.js";
import { readViews } from "./readViews.js";
const address = contractAddress(new Uint8Array(32));
const writer = new CxsWriter();
writer.writeInt128(12n);
const returned = {
  output: { result: "return", returnData: toHex0x(writer.finish()) },
  gasUsed: "17",
  events: [],
};
const call = ERC20.v0_1.totalSupply.viewRequest({ address });
describe("native shared-snapshot reads", () => {
  it("preserves ordered successful, fault and future outcomes at one state height", async () => {
    const request = vi.fn(async () => ({
      stateBlockHeight: "9007199254740993",
      results: [
        returned,
        { output: { result: "fault" }, gasUsed: "1", events: [] },
        { output: { result: "future", extra: 4 }, gasUsed: "2", events: [] },
      ],
    }));
    const rpc = await testRpc({ request: request as never });
    const result = await readViews(rpc, {
      calls: [call, call, call],
      minStateBlockHeight: 9007199254740993n,
    });
    expect(result.stateBlockHeight).toBe(9007199254740993n);
    expect(result.results[0]).toMatchObject({ kind: "return", value: 12n });
    expect(result.results[1]).toMatchObject({ kind: "fault" });
    expect(result.results[2]).toMatchObject({ kind: "unsupported" });
    expect(request).toHaveBeenCalledWith(
      "simulateInvocations",
      expect.objectContaining({
        minStateBlockHeight: "9007199254740993",
        invocations: expect.any(Array),
      }),
      undefined,
    );
  });
  it.each([0, 2])("rejects mismatched result count %s", async (count) => {
    const rpc = await testRpc({
      request: async () =>
        ({
          stateBlockHeight: "4",
          results: Array(count).fill(returned),
        }) as never,
    });
    await expect(readViews(rpc, { calls: [call] })).rejects.toThrow();
  });
  it("retains decoder order while the caller edits its list", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise((r) => (resolve = r)));
    const rpc = await testRpc({ request: request as never });
    const calls = [call];
    const pending = readViews(rpc, { calls });
    calls.length = 0;
    resolve({ stateBlockHeight: "4", results: [returned] });
    expect((await pending).results).toHaveLength(1);
  });
  it("rejects malformed return bytes without masking raw RPC errors", async () => {
    const rpc = await testRpc({
      request: async () =>
        ({
          stateBlockHeight: "4",
          results: [
            { ...returned, output: { result: "return", returnData: "0xff" } },
          ],
        }) as never,
    });
    await expect(readViews(rpc, { calls: [call] })).rejects.toThrow(
      "Failed to decode readViews result 0",
    );
  });
});
