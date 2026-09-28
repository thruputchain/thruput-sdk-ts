import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  calldata,
  contractAddress,
  contractEntrypointID,
} from "@groundhogchain/protocol";
import { ERC20 } from "../../contracts/index.js";
import { createGroundhogClient } from "../../client.js";
import { getContract } from "../../contract/instance.js";
import { ContractDecodeError } from "../../contract/errors.js";
import type { Transport } from "../../transport/types.js";
import { JsonRpcError } from "../../transport/http.js";
import { viewBatch } from "./viewBatch.js";
import { readViews } from "./readViews.js";
import { CxsWriter } from "@groundhogchain/xdr";
import { toHex0x } from "../hex.js";

const address = contractAddress(new Uint8Array(32).fill(1));
const call = {
  contract: address,
  entrypoint: contractEntrypointID(new Uint8Array(8)),
  calldata: calldata(new Uint8Array()),
};
const fault = { output: { result: "fault" }, events: [] };
const writer = new CxsWriter();
writer.writeInt128(12n);
const returned = {
  output: { result: "return", returnData: toHex0x(writer.finish()) },
  events: [],
};
const exception = new CxsWriter();
exception.writeUint64(7n);
function stub(response: unknown) {
  const request = vi.fn(
    async (_method: string, _params?: unknown[], _options?: unknown) =>
      response,
  );
  return { transport: { request } as Transport, request };
}

describe("shared-snapshot reads", () => {
  it("retains tuple return types and ordered return, abort, and fault outcomes", async () => {
    const { transport, request } = stub({
      height: 42,
      results: [
        returned,
        {
          output: { result: "abort", abortData: toHex0x(exception.finish()) },
          events: [],
        },
        fault,
      ],
    });
    const client = await createGroundhogClient({ transport });
    const result = await client.readViews({
      calls: [
        ERC20.totalSupply.viewRequest({ contract: address }),
        ERC20.transfer.viewRequest({
          contract: address,
          args: { receiver: address, amount: 1n },
        }),
        ERC20.totalSupply.viewRequest({ contract: address, caller: address }),
      ],
      minHeight: 42n,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("groundhog_viewBatch");
    expect(result.height).toBe(42n);
    const [supply, transfer, failed] = result.results;
    if (supply.kind !== "return") throw new Error("Expected return");
    expectTypeOf(supply.value).toEqualTypeOf<bigint>();
    expect(supply.value).toBe(12n);
    if (transfer.kind === "return")
      expectTypeOf(transfer.value).toEqualTypeOf<void>();
    expect(transfer).toMatchObject({
      kind: "abort",
      exception: { kind: "unknown", selector: 7n },
    });
    expect(failed.kind).toBe("fault");
  });

  it("copies prepared address, caller, and arguments and supports bound methods", async () => {
    const contract = contractAddress(address.slice());
    const caller = contractAddress(address.slice());
    const owner = contractAddress(address.slice());
    const { transport } = stub({ height: 1, results: [returned] });
    const client = await createGroundhogClient({ transport });
    const bound = getContract({ binding: ERC20, address: contract, client });
    const prepared = bound.getBalanceOf.viewRequest({
      caller,
      args: { addr: owner },
    });
    contract.fill(0);
    caller.fill(0);
    owner.fill(0);
    expect(prepared.request.contract).toEqual(address);
    expect(prepared.request.caller).toEqual(address);
    expect(
      ERC20.getBalanceOf.decodeArgs(prepared.request.calldata).addr,
    ).toEqual(address);
    expect(
      (await client.readViews({ calls: [prepared] })).results[0].kind,
    ).toBe("return");
  });

  it.each([{ calls: [] }, { calls: Array.from({ length: 17 }, () => call) }])(
    "rejects invalid call counts before I/O",
    async ({ calls }) => {
      const { transport, request } = stub(null);
      await expect(viewBatch(transport, { calls })).rejects.toThrow(
        "between 1 and 16",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized input and unsafe minimum heights before I/O", async () => {
    const { transport, request } = stub(null);
    await expect(
      viewBatch(transport, {
        calls: [{ ...call, calldata: calldata(new Uint8Array(65_537)) }],
      }),
    ).rejects.toThrow("64 KiB");
    await expect(
      viewBatch(transport, { calls: [call], minHeight: 9007199254740992n }),
    ).rejects.toThrow("safe integer");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { height: 42, results: [] },
    { height: 42, results: [fault, fault] },
    { height: 41, results: [fault] },
    { height: -1, results: [fault] },
    { height: 9007199254740992, results: [fault] },
    { height: 42, results: [{ output: { result: "other" }, events: [] }] },
    { height: 42, results: [{ output: { result: "fault" }, events: null }] },
  ])("rejects malformed or stale group responses", async (raw) => {
    await expect(
      viewBatch(stub(raw).transport, { calls: [call], minHeight: 42n }),
    ).rejects.toThrow();
  });

  it("propagates unsupported-method errors without a separate-view fallback", async () => {
    const error = new JsonRpcError(-32601, "Method not found");
    const request = vi.fn().mockRejectedValue(error);
    await expect(
      readViews(
        { request },
        { calls: [ERC20.totalSupply.viewRequest({ contract: address })] },
      ),
    ).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed typed return data", async () => {
    const { transport } = stub({
      height: 42,
      results: [{ output: { result: "return", returnData: "0x" }, events: [] }],
    });
    await expect(
      readViews(transport, {
        calls: [ERC20.totalSupply.viewRequest({ contract: address })],
      }),
    ).rejects.toBeInstanceOf(ContractDecodeError);
  });

  it("honors cancellation before I/O and forwards the group signal", async () => {
    const { transport, request } = stub({ height: 1, results: [fault] });
    const controller = new AbortController();
    await viewBatch(
      transport,
      { calls: [call] },
      { signal: controller.signal },
    );
    expect(request).toHaveBeenLastCalledWith(
      "groundhog_viewBatch",
      expect.any(Array),
      { signal: controller.signal },
    );
    controller.abort();
    await expect(
      viewBatch(transport, { calls: [call] }, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
