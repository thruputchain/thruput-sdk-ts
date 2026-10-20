import { describe, expect, it, vi } from "vitest";
import { contractAddress } from "@thruputchain/protocol";
import { CxsWriter } from "@thruputchain/xdr";
import { ERC20 } from "../../contracts/index.js";
import { testRpc } from "../../testing/nativeRpc.js";
import { toHex0x } from "../hex.js";
const address = contractAddress(new Uint8Array(32));
const writer = new CxsWriter();
writer.writeInt128(12n);
const returned = {
  output: { result: "return", returnData: toHex0x(writer.finish()) },
  gasUsed: "17",
  events: [],
};
describe("native simulation freshness", () => {
  it.each([undefined, 0n, 42n, 9007199254740993n])(
    "preserves stateBlockHeight and requested minimum %s",
    async (minStateBlockHeight) => {
      const height = minStateBlockHeight ?? 42n;
      const request = vi.fn(async () => ({
        ...returned,
        stateBlockHeight: String(height),
      }));
      const rpc = await testRpc({ request: request as never });
      const result = await ERC20.v0_1.totalSupply.view({
        client: rpc,
        address,
        minStateBlockHeight,
      });
      expect(result).toMatchObject({
        value: 12n,
        stateBlockHeight: height,
        gasUsed: 17n,
      });
      expect(request).toHaveBeenCalledWith(
        "simulateInvocation",
        expect.objectContaining(
          minStateBlockHeight === undefined
            ? {}
            : { minStateBlockHeight: String(minStateBlockHeight) },
        ),
        undefined,
      );
    },
  );
  it.each([-1n, 1n << 63n])(
    "rejects invalid minimum before dispatch",
    async (minStateBlockHeight) => {
      const request = vi.fn();
      const rpc = await testRpc({ request });
      await expect(
        ERC20.v0_1.totalSupply.view({
          client: rpc,
          address,
          minStateBlockHeight,
        }),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects a stale response rather than passing it to the decoder", async () => {
    const rpc = await testRpc({
      request: async () => ({ ...returned, stateBlockHeight: "4" }) as never,
    });
    await expect(
      ERC20.v0_1.totalSupply.view({
        client: rpc,
        address,
        minStateBlockHeight: 5n,
      }),
    ).rejects.toThrow();
  });
});
