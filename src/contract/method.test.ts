import { describe, expect, it, vi } from "vitest";
import {
  CxsReader,
  CxsWriter,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  kMaxReturnBufferLen,
} from "@groundhogchain/protocol";
import { ContractTypeKind } from "@groundhogchain/contract-spec";
import type { GroundhogClient } from "../client.js";
import type { EmittedEvent, ViewResponse } from "../types/rpc.js";
import { createContractCodecContext } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import {
  ContractViewError,
  defineContractMethod,
  type ContractMethodDefinition,
} from "./method.js";

const contract = contractAddress(new Uint8Array(32).fill(0x11));
const caller = contractAddress(new Uint8Array(32).fill(0x22));
const entrypoint = contractEntrypointID(new Uint8Array(8).fill(0x33));
const events: EmittedEvent[] = [];

function definition(
  overrides: Partial<ContractMethodDefinition> = {},
): ContractMethodDefinition {
  return {
    entrypoint,
    args: [
      {
        abiName: "second_abi",
        publicName: "second",
        type: { v: ContractTypeKind.U32 },
      },
      {
        abiName: "first_abi",
        publicName: "first",
        type: { v: ContractTypeKind.I32 },
      },
    ],
    returnType: { v: ContractTypeKind.I64 },
    throws: [
      {
        selector: 7n,
        name: "BadValue",
        type: { v: ContractTypeKind.I32 },
      },
    ],
    codecs: createContractCodecContext([]),
    ...overrides,
  };
}

function encode(write: (writer: CxsWriter) => void): Uint8Array {
  const writer = new CxsWriter();
  write(writer);
  return writer.finish();
}

function clientReturning(response: ViewResponse) {
  return {
    view: vi.fn(async () => response),
  } satisfies Pick<GroundhogClient, "view">;
}

describe("contract method invocation", () => {
  it("encodes object arguments in ABI metadata order", () => {
    const method = defineContractMethod<
      { first: bigint; second: bigint },
      bigint,
      never
    >(definition());

    const invocation = method.invocation(contract, gasAmount(100n), {
      first: -4n,
      second: 300n,
    });
    const reader = new CxsReader(invocation.calldata);

    expect(invocation).toMatchObject({
      invoked_address: contract,
      entrypoint,
      gas_limit: 100n,
    });
    expect(reader.readUint32()).toBe(300n);
    expect(reader.readInt32()).toBe(-4n);
    expect(reader.remaining).toBe(0);
  });

  it("encodes no calldata for a zero-argument method", () => {
    const method = defineContractMethod<void, void, never>(
      definition({
        args: [],
        returnType: { v: ContractTypeKind.Void },
        throws: [],
      }),
    );

    expect(method.invocation(contract, gasAmount(1n)).calldata).toHaveLength(0);
  });

  it("returns independent entrypoint copies", () => {
    const source = contractEntrypointID(Buffer.alloc(8, 0x44));
    const method = defineContractMethod<void, void, never>(
      definition({
        entrypoint: source,
        args: [],
        returnType: { v: ContractTypeKind.Void },
        throws: [],
      }),
    );

    source.fill(0);
    const exposed = method.entrypoint;
    exposed.fill(0);
    const invocation = method.invocation(contract, gasAmount(1n));
    invocation.entrypoint.fill(0);

    expect(method.entrypoint).toEqual(new Uint8Array(8).fill(0x44));
    expect(method.invocation(contract, gasAmount(1n)).entrypoint).toEqual(
      new Uint8Array(8).fill(0x44),
    );
  });

  it("rejects missing runtime argument objects", () => {
    const method = defineContractMethod<Record<string, bigint>, bigint, never>(
      definition(),
    );

    expect(() =>
      method.invocation(contract, gasAmount(1n), undefined as never),
    ).toThrow("Contract method arguments must be an object");
  });

  it("rejects arguments inherited through the prototype chain", () => {
    const method = defineContractMethod<
      { first: bigint; second: bigint },
      bigint,
      never
    >(definition());
    const inherited = Object.create({ first: -4n, second: 300n }) as {
      first: bigint;
      second: bigint;
    };

    expect(() => method.invocation(contract, gasAmount(1n), inherited)).toThrow(
      'Contract method arguments require own property "second"',
    );
  });

  it("snapshots argument metadata used by invocations", () => {
    const source = definition();
    const method = defineContractMethod<
      { first: bigint; second: bigint },
      bigint,
      never
    >(source);

    source.args[0]!.publicName = "mutated";

    expect(() =>
      method.invocation(contract, gasAmount(1n), {
        first: -4n,
        second: 300n,
      }),
    ).not.toThrow();
  });
});

describe("contract method decoding", () => {
  const method = defineContractMethod<unknown, bigint, unknown>(definition());

  it("decodes a complete return value", () => {
    expect(
      method.decodeReturn(encode((writer) => writer.writeInt64(-42n))),
    ).toBe(-42n);
  });

  it("rejects malformed and trailing return data", () => {
    expect(() => method.decodeReturn(new Uint8Array())).toThrowError(
      ContractDecodeError,
    );

    const data = encode((writer) => {
      writer.writeInt64(1n);
      writer.writeInt32(2n);
    });
    expect(() => method.decodeReturn(data)).toThrow(/trailing bytes/);
  });

  it("enforces the protocol return and abort buffer limit", () => {
    const oversized = new Uint8Array(Number(kMaxReturnBufferLen) + 1);

    expect(() => method.decodeReturn(oversized)).toThrow(
      /Contract return data exceeds 1024 bytes: 1025/,
    );
    expect(() => method.decodeException(oversized)).toThrow(
      /Contract abort data exceeds 1024 bytes: 1025/,
    );
  });

  it("decodes declared exceptions and rejects trailing bytes", () => {
    const data = encode((writer) => {
      writer.writeUint64(7n);
      writer.writeInt32(-9n);
    });

    expect(method.decodeException(data)).toEqual({
      kind: "declared",
      selector: 7n,
      name: "BadValue",
      value: -9n,
    });

    const trailing = new Uint8Array(data.length + 1);
    trailing.set(data);
    expect(() => method.decodeException(trailing)).toThrow(
      /Failed to decode contract exception: 1 trailing bytes/,
    );
  });

  it("snapshots declared exception metadata", () => {
    const source = definition();
    const descriptor = defineContractMethod<unknown, bigint, unknown>(source);
    source.throws[0]!.name = "Mutated";
    const data = encode((writer) => {
      writer.writeUint64(7n);
      writer.writeInt32(-9n);
    });

    expect(descriptor.decodeException(data)).toMatchObject({
      name: "BadValue",
    });
  });

  it("preserves unknown exceptions and their complete abort data", () => {
    const data = encode((writer) => {
      writer.writeUint64(99n);
      writer.writeInt32(123n);
    });

    expect(method.decodeException(data)).toEqual({
      kind: "unknown",
      selector: 99n,
      data,
    });
  });

  it("wraps malformed exception selectors", () => {
    expect(() => method.decodeException(Uint8Array.of(0xff))).toThrow(
      /Failed to decode contract exception/,
    );
  });
});

describe("contract method views", () => {
  const method = defineContractMethod<
    { first: bigint; second: bigint },
    bigint,
    unknown
  >(definition());

  it("returns decoded values and forwards arguments and caller", async () => {
    const client = clientReturning({
      output: {
        result: "return",
        returnData: encode((writer) => writer.writeInt64(-8n)),
      },
      height: 12n,
      events,
    });

    await expect(
      method.viewOutcome({
        client,
        contract,
        caller,
        args: { first: -2n, second: 5n },
      }),
    ).resolves.toEqual({ kind: "return", value: -8n, height: 12n, events });
    expect(client.view).toHaveBeenCalledWith({
      contract,
      entrypoint,
      caller,
      calldata: expect.any(Uint8Array),
    });
  });

  it("the ergonomic view resolves successful return metadata", async () => {
    const client = clientReturning({
      output: {
        result: "return",
        returnData: encode((writer) => writer.writeInt64(17n)),
      },
      height: 13n,
      events,
    });

    await expect(
      method.view({
        client,
        contract,
        args: { first: 1n, second: 2n },
      }),
    ).resolves.toEqual({ value: 17n, height: 13n, events });
  });

  it("returns declared exceptions and fault outcomes without throwing", async () => {
    const abortData = encode((writer) => {
      writer.writeUint64(7n);
      writer.writeInt32(-1n);
    });
    const abortClient = clientReturning({
      output: { result: "abort", abortData },
      height: 20n,
      events,
    });
    const faultClient = clientReturning({
      output: { result: "fault" },
      height: 21n,
      events,
    });
    const args = { first: 1n, second: 2n };

    await expect(
      method.viewOutcome({ client: abortClient, contract, args }),
    ).resolves.toEqual({
      kind: "abort",
      exception: {
        kind: "declared",
        selector: 7n,
        name: "BadValue",
        value: -1n,
      },
      abortData,
      height: 20n,
      events,
    });
    await expect(
      method.viewOutcome({ client: faultClient, contract, args }),
    ).resolves.toEqual({ kind: "fault", height: 21n, events });
  });

  it("returns unknown exceptions in abort outcomes losslessly", async () => {
    const abortData = encode((writer) => writer.writeUint64(88n));
    const client = clientReturning({
      output: { result: "abort", abortData },
      height: 30n,
      events,
    });

    await expect(
      method.viewOutcome({
        client,
        contract,
        args: { first: 1n, second: 2n },
      }),
    ).resolves.toMatchObject({
      kind: "abort",
      exception: { kind: "unknown", selector: 88n, data: abortData },
    });
  });

  it.each(["abort", "fault"] as const)(
    "the ergonomic view throws ContractViewError for %s outcomes",
    async (result) => {
      const abortData = encode((writer) => writer.writeUint64(88n));
      const client = clientReturning({
        output: result === "abort" ? { result, abortData } : { result },
        height: 1n,
        events,
      });

      const promise = method.view({
        client,
        contract,
        args: { first: 1n, second: 2n },
      });
      await expect(promise).rejects.toBeInstanceOf(ContractViewError);
      await expect(promise).rejects.toMatchObject({
        outcome: { kind: result },
      });
    },
  );

  it("propagates client failures without wrapping them", async () => {
    const failure = new Error("gateway unavailable");
    const client = {
      view: vi.fn(async () => {
        throw failure;
      }),
    } satisfies Pick<GroundhogClient, "view">;

    await expect(
      method.viewOutcome({
        client,
        contract,
        args: { first: 1n, second: 2n },
      }),
    ).rejects.toBe(failure);
  });
});
