import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  calldata,
  contractAddress,
  contractEntrypointID,
  gasAmount,
} from "@thruputchain/protocol";
import { CxsWriter } from "@thruputchain/xdr";
import { createThruputClient } from "../../client.js";
import { ERC20 as ERC20Versions } from "../../contracts/index.js";
import { getContract } from "../../contract/instance.js";
import { ContractViewError } from "../../contract/method.js";
import { JsonRpcError } from "../../transport/http.js";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import { toHex0x } from "../hex.js";
import { view } from "./view.js";
import { viewBatch } from "./viewBatch.js";
import { readViews } from "./readViews.js";

const ERC20 = ERC20Versions.v0_1;
const address = contractAddress(new Uint8Array(32).fill(1));
const call = {
  contract: address,
  entrypoint: contractEntrypointID(new Uint8Array(8)),
  calldata: calldata(new Uint8Array()),
  caller: address,
  gasLimit: 123n,
};
const writer = new CxsWriter();
writer.writeInt128(12n);
const response = {
  height: "42",
  gasUsed: "17",
  output: { result: "return", returnData: toHex0x(writer.finish()) },
  events: [{ contractAddress: toHex0x(address), topics: [], data: "0x0102" }],
};
function stub(result: unknown = response) {
  const request = vi.fn(
    async (
      _method: string,
      _params?: unknown[],
      _options?: TransportRequestOptions,
    ) => result,
  );
  return { transport: { request } as Transport, request };
}

describe("single-view freshness", () => {
  it.each([undefined, 0n, 41n, 42n, 9007199254740993n])(
    "preserves request shape and full-width heights: %s",
    async (minHeight) => {
      const height =
        minHeight !== undefined && minHeight > 42n ? minHeight : 42n;
      const { transport, request } = stub({
        ...response,
        height: height.toString(),
      });
      const result = await view(transport, {
        ...call,
        ...(minHeight === undefined ? {} : { minHeight }),
      });
      expect(result.height).toBe(height);
      expect(result.gasUsed).toBe(17n);
      expect(result.events[0]?.data).toEqual(new Uint8Array([1, 2]));
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "groundhog_view",
        [
          {
            contract: toHex0x(address),
            entrypoint: toHex0x(call.entrypoint),
            calldata: "0x",
            caller: toHex0x(address),
            gasLimit: "123",
            ...(minHeight === undefined
              ? {}
              : { minHeight: minHeight.toString() }),
          },
        ],
        undefined,
      );
    },
  );

  it.each([-1n, 1n << 63n, 42 as unknown as bigint])(
    "rejects invalid minimum heights before I/O: %s",
    async (minHeight) => {
      const { transport, request } = stub();
      await expect(view(transport, { ...call, minHeight })).rejects.toThrow(
        "non-negative int64 bigint",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects stale successes without polling or dropping the constraint", async () => {
    const { transport, request } = stub();
    await expect(view(transport, { ...call, minHeight: 43n })).rejects.toThrow(
      "below the requested minimum 43",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retains the original minimum while a request is pending", async () => {
    let finish!: (result: unknown) => void;
    const transport: Transport = {
      request: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const input = { ...call, minHeight: 43n };
    const pending = view(transport, input);
    input.minHeight = 0n;
    finish(response);
    await expect(pending).rejects.toThrow("minimum 43");
  });

  it.each([
    new JsonRpcError(-32011, "View height unavailable", {
      requested: "43",
      observed: "42",
    }),
    new JsonRpcError(-32601, "Method not found"),
    new Error("Connection lost"),
  ])("propagates server and transport errors unchanged: %s", async (error) => {
    const request = vi.fn().mockRejectedValue(error);
    await expect(view({ request }, { ...call, minHeight: 43n })).rejects.toBe(
      error,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("forwards cancellation and stops before I/O when already aborted", async () => {
    const controller = new AbortController();
    const request = vi.fn(
      (_method: string, _params: unknown, options?: TransportRequestOptions) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    const pending = view(
      { request } as Transport,
      { ...call, minHeight: 42n },
      { signal: controller.signal },
    );
    controller.abort(new Error("cancelled read"));
    await expect(pending).rejects.toBe(controller.signal.reason);
    await expect(
      view({ request } as Transport, call, { signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
  });

  it("supports generated and bound views with typed outcomes and metadata", async () => {
    const { transport, request } = stub();
    const client = await createThruputClient({ transport });
    const bound = getContract({ binding: ERC20, address, client });
    const options = {
      contract: address,
      client,
      minHeight: 42n,
      caller: address,
    };
    const result = await ERC20.totalSupply.view(options);
    expectTypeOf(result.value).toEqualTypeOf<bigint>();
    expect(result).toMatchObject({ value: 12n, height: 42n, gasUsed: 17n });
    const outcomes = [
      await ERC20.totalSupply.viewOutcome(options),
      await bound.totalSupply.viewOutcome({ minHeight: 42n, caller: address }),
    ];
    for (const outcome of outcomes) {
      if (outcome.kind !== "return") throw new Error("expected return");
      expectTypeOf(outcome.value).toEqualTypeOf<bigint>();
      expect(outcome.value).toBe(12n);
      expect(outcome.events[0]?.data).toEqual(new Uint8Array([1, 2]));
    }
    expect((await bound.totalSupply.view({ minHeight: 42n })).value).toBe(12n);
    for (const [, params] of request.mock.calls)
      expect(params?.[0]).toMatchObject({ minHeight: "42" });
  });

  it("checks typed views even with a custom client implementation", async () => {
    const client = {
      view: vi.fn().mockResolvedValue({
        output: { result: "fault" },
        height: 41n,
        gasUsed: 1n,
        events: [],
      }),
    };
    await expect(
      ERC20.totalSupply.viewOutcome({
        client,
        contract: address,
        minHeight: 42n,
      }),
    ).rejects.toThrow("minimum 42");
    await expect(
      ERC20.totalSupply.view({ client, contract: address, minHeight: 42n }),
    ).rejects.toThrow("minimum 42");
  });

  it("preserves contract faults as typed outcomes after the floor is met", async () => {
    const client = await createThruputClient({
      transport: stub({ ...response, output: { result: "fault" } }).transport,
    });
    const options = { client, contract: address, minHeight: 42n };
    await expect(ERC20.totalSupply.viewOutcome(options)).resolves.toMatchObject(
      { kind: "fault", height: 42n, gasUsed: 17n },
    );
    await expect(ERC20.totalSupply.view(options)).rejects.toBeInstanceOf(
      ContractViewError,
    );
  });

  it("preserves typed abort outcomes after the floor is met", async () => {
    const writer = new CxsWriter();
    writer.writeUint64(7n);
    const client = await createThruputClient({
      transport: stub({
        ...response,
        output: { result: "abort", abortData: toHex0x(writer.finish()) },
      }).transport,
    });
    const options = { client, contract: address, minHeight: 42n };
    await expect(ERC20.totalSupply.viewOutcome(options)).resolves.toMatchObject(
      {
        kind: "abort",
        exception: { kind: "unknown", selector: 7n },
        height: 42n,
        gasUsed: 17n,
      },
    );
    await expect(ERC20.totalSupply.view(options)).rejects.toBeInstanceOf(
      ContractViewError,
    );
  });

  it("rejects per-entry and transaction freshness controls instead of ignoring them", async () => {
    const { transport, request } = stub();
    const prepared = {
      ...ERC20.totalSupply.viewRequest({ contract: address }),
      minHeight: 42n,
    };
    await expect(
      // @ts-expect-error prepared entries cannot carry group constraints
      readViews(transport, { calls: [prepared] }),
    ).rejects.toThrow("readViews");
    await expect(
      // @ts-expect-error freshness belongs to the group
      viewBatch(transport, { calls: [{ ...call, minHeight: 42n }] }),
    ).rejects.toThrow("batch request");
    expect(() =>
      // @ts-expect-error prepared entries cannot set freshness
      ERC20.totalSupply.viewRequest({ contract: address, minHeight: 42n }),
    ).toThrow("readViews");
    expect(() =>
      ERC20.totalSupply.call({
        contract: address,
        gasLimit: gasAmount(123n),
        // @ts-expect-error transaction calls cannot set read freshness
        minHeight: 42n,
      }),
    ).toThrow("transaction option");
    expect(request).not.toHaveBeenCalled();
  });
});
