import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  calldata,
  contractAddress,
  contractEntrypointID,
} from "@thruputchain/protocol";
import { ERC20 as ERC20Versions } from "../../contracts/index.js";
import { createThruputClient } from "../../client.js";
import { getContract } from "../../contract/instance.js";
import type { Transport } from "../../transport/types.js";
import { JsonRpcError } from "../../transport/http.js";
import { viewBatch, ViewBatchResultError } from "./viewBatch.js";
import { ContractDecodeError } from "../../contract/errors.js";
import { readViews } from "./readViews.js";
import { CxsWriter } from "@thruputchain/xdr";
import { toHex0x } from "../hex.js";

const ERC20 = ERC20Versions.v0_1;
const address = contractAddress(new Uint8Array(32).fill(1));
const call = {
  contract: address,
  entrypoint: contractEntrypointID(new Uint8Array(8)),
  calldata: calldata(new Uint8Array()),
};
const fault = { output: { result: "fault" }, events: [], gasUsed: "1" };
const writer = new CxsWriter();
writer.writeInt128(12n);
const returned = {
  gasUsed: "12",
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
  it("serializes full-width heights and per-call gas budgets without rounding", async () => {
    const { transport, request } = stub({
      height: "9007199254740993",
      results: [fault],
    });
    const result = await viewBatch(transport, {
      calls: [{ ...call, gasLimit: 123n }],
      minHeight: 9007199254740993n,
    });
    expect(result.height).toBe(9007199254740993n);
    expect(request).toHaveBeenCalledWith(
      "groundhog_viewBatch",
      [
        {
          calls: [expect.objectContaining({ gasLimit: "123" })],
          minHeight: "9007199254740993",
        },
      ],
      undefined,
    );
  });

  it.each([0n, -1n, 1n << 64n])(
    "rejects invalid gas budgets before I/O: %s",
    async (gasLimit) => {
      const { transport, request } = stub(null);
      await expect(
        viewBatch(transport, { calls: [{ ...call, gasLimit }] }),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("retains tuple return types and ordered return, abort, and fault outcomes", async () => {
    const { transport, request } = stub({
      height: "42",
      results: [
        returned,
        {
          output: { result: "abort", abortData: toHex0x(exception.finish()) },
          gasUsed: "7",
          events: [],
        },
        fault,
      ],
    });
    const client = await createThruputClient({ transport });
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
    expect(supply.gasUsed).toBe(12n);
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
    const { transport } = stub({ height: "1", results: [returned] });
    const client = await createThruputClient({ transport });
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

  it.each([{ calls: [] }])(
    "rejects invalid call counts before I/O",
    async ({ calls }) => {
      const { transport, request } = stub(null);
      await expect(viewBatch(transport, { calls })).rejects.toThrow(
        "at least one",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects out-of-range minimum heights before I/O", async () => {
    const { transport, request } = stub(null);
    await expect(
      viewBatch(transport, { calls: [call], minHeight: 1n << 63n }),
    ).rejects.toThrow("non-negative int64");
    expect(request).not.toHaveBeenCalled();
  });

  it("leaves count and calldata policy to the endpoint without splitting", async () => {
    const { transport, request } = stub({
      height: "42",
      results: Array(17).fill(fault),
    });
    await viewBatch(transport, {
      calls: Array.from({ length: 17 }, () => ({
        ...call,
        calldata: calldata(new Uint8Array(4096)),
      })),
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("groundhog_viewBatch");
  });

  it.each([
    { height: "42", results: [] },
    { height: "42", results: [fault, fault] },
    { height: "41", results: [fault] },
    { height: "-1", results: [fault] },
    { height: "042", results: [fault] },
    { height: "9223372036854775808", results: [fault] },
    { height: 42, results: [fault] },
    { height: 9007199254740992, results: [fault] },
    { height: "42", results: [{ output: { result: "other" }, events: [] }] },
    { height: "42", results: [{ output: { result: "fault" }, events: null }] },
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

  it("rejects malformed typed return data with method context", async () => {
    const { transport } = stub({
      height: "42",
      results: [
        {
          output: { result: "return", returnData: "0x" },
          events: [],
          gasUsed: "1",
        },
      ],
    });
    await expect(
      readViews(transport, {
        calls: [ERC20.totalSupply.viewRequest({ contract: address })],
      }),
    ).rejects.toThrow("readViews result 0 (ERC20.totalSupply)");
  });

  it("honors cancellation before I/O and forwards the group signal", async () => {
    const { transport, request } = stub({ height: "1", results: [fault] });
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

  it.each([
    null,
    { ...fault, output: { result: "other" } },
    { ...fault, output: { result: "return", returnData: "0xgg" } },
    { ...fault, gasUsed: 1 },
    { ...fault, gasUsed: "01" },
    { ...fault, events: null },
    { ...fault, events: [{}] },
  ])(
    "identifies malformed results by index and retained method name: %j",
    async (malformed) => {
      const response = { height: "42", results: [returned, malformed] };
      await expect(
        viewBatch(stub(response).transport, { calls: [call, call] }),
      ).rejects.toMatchObject({
        name: "ViewBatchResultError",
        index: 1,
        cause: expect.any(Error),
      });
      const calls = [
        ERC20.totalSupply.viewRequest({ contract: address }),
        ERC20.getBalance.viewRequest({ contract: address }),
      ];
      let finish!: (response: unknown) => void;
      const transport: Transport = {
        request: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        ),
      };
      const pending = readViews(transport, { calls });
      calls.reverse();
      finish(response);
      await expect(pending).rejects.toMatchObject({
        message: "Failed to decode readViews result 1 (ERC20.getBalance)",
        cause: expect.any(ViewBatchResultError),
      });
      await expect(pending).rejects.toBeInstanceOf(ContractDecodeError);
    },
  );

  it.each([
    new JsonRpcError(-32011, "View height unavailable", {
      requested: "42",
      observed: "41",
    }),
    new DOMException("Aborted", "AbortError"),
    new Error("Connection lost"),
  ])("preserves transport and cancellation errors: %s", async (error) => {
    await expect(
      readViews(
        { request: vi.fn().mockRejectedValue(error) },
        {
          calls: [ERC20.totalSupply.viewRequest({ contract: address })],
        },
      ),
    ).rejects.toBe(error);
  });
});
