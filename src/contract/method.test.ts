import { describe, expect, it, vi } from "vitest";
import {
  AuthClaimType,
  bitMap,
  weight,
  type AuthClaim,
  CxsReader,
  CxsWriter,
  ExecResult,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  sha256Hash,
} from "@thruputchain/protocol";
import {
  ContractMethodEffect,
  ContractTypeKind,
} from "@thruputchain/contract-spec";
import { DefaultWallet, ERC20 } from "../contracts/index.js";
import { getContract } from "./instance.js";
import type { ThruputClient } from "../client.js";
import type {
  EmittedEvent,
  TransactionReceipt,
  ViewResponse,
} from "../types/rpc.js";
import { createContractCodecContext } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import {
  ContractReceiptError,
  ContractViewError,
  defineContractMethod,
  type ContractMethodDefinition,
} from "./method.js";

const address = contractAddress(new Uint8Array(32).fill(0x11));
const caller = contractAddress(new Uint8Array(32).fill(0x22));
const entrypoint = contractEntrypointID(new Uint8Array(8).fill(0x33));
const txHash = sha256Hash(new Uint8Array(32).fill(0x44));
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
    simulateInvocation: vi.fn(async () => response),
  } satisfies Pick<ThruputClient, "simulateInvocation">;
}

function receipt(
  overrides: Partial<TransactionReceipt> = {},
): TransactionReceipt {
  return {
    transactionHash: txHash,
    blockHeight: 12n,
    execution: { result: "return", returnData: new Uint8Array() },
    events,
    gasUsed: 1_000n,
    ...overrides,
  };
}

describe("contract method invocation", () => {
  it.each([
    undefined,
    null,
    ContractMethodEffect.EffectPure,
    ContractMethodEffect.EffectReadOnly,
    ContractMethodEffect.EffectStateChanging,
  ])(
    "preserves declared effect %s without restricting call or view paths",
    async (effect) => {
      const method = defineContractMethod<void, void, never>(
        definition({
          ...(effect === undefined ? {} : { effect }),
          args: [],
          returnType: { v: ContractTypeKind.Void },
        }),
      );
      expect(method.effect).toBe(effect ?? null);
      expect(
        method.call({ address, gasLimit: gasAmount(100n) }).invocation
          .entrypoint,
      ).toEqual(entrypoint);
      const client = clientReturning({
        output: { result: "return", returnData: new Uint8Array() },
        stateBlockHeight: 1n,
        gasUsed: 1n,
        events: [],
      });
      const bound = getContract({
        binding: { method },
        address: address,
        client,
      });
      expect(bound.method.effect).toBe(method.effect);
      await bound.method.view({});
      expect(client.simulateInvocation).toHaveBeenCalledOnce();
    },
  );

  it("rejects unsupported effect values rather than treating them as read-only", () => {
    expect(() =>
      defineContractMethod(definition({ effect: 99 as ContractMethodEffect })),
    ).toThrow("Unsupported contract method effect");
  });
  it("encodes object arguments in ABI metadata order", () => {
    const method = defineContractMethod<
      { first: bigint; second: bigint },
      bigint,
      never
    >(definition());

    const invocation = method.invocation(address, gasAmount(100n), {
      first: -4n,
      second: 300n,
    });
    const reader = new CxsReader(invocation.calldata);

    expect(invocation).toMatchObject({
      invoked_address: address,
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

    expect(method.invocation(address, gasAmount(1n)).calldata).toHaveLength(0);
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
    const invocation = method.invocation(address, gasAmount(1n));
    invocation.entrypoint.fill(0);

    expect(method.entrypoint).toEqual(new Uint8Array(8).fill(0x44));
    expect(method.invocation(address, gasAmount(1n)).entrypoint).toEqual(
      new Uint8Array(8).fill(0x44),
    );
  });

  it("rejects missing runtime argument objects", () => {
    const method = defineContractMethod<Record<string, bigint>, bigint, never>(
      definition(),
    );

    expect(() =>
      method.invocation(address, gasAmount(1n), undefined as never),
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

    expect(() => method.invocation(address, gasAmount(1n), inherited)).toThrow(
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
      method.invocation(address, gasAmount(1n), {
        first: -4n,
        second: 300n,
      }),
    ).not.toThrow();
  });
});

describe("contract argument decoding", () => {
  const method = defineContractMethod<
    { first: bigint; second: bigint },
    bigint,
    never
  >(definition({ interfaceName: "Example", publicName: "update" }));

  it("decodes ABI order into public argument names", () => {
    const data = encode((writer) => {
      writer.writeUint32(300n);
      writer.writeInt32(-4n);
    });
    expect(method.decodeArgs(data)).toEqual({ second: 300n, first: -4n });
  });

  it("identifies the method and argument on truncated calldata", () => {
    expect(() =>
      method.decodeArgs(encode((writer) => writer.writeUint32(300n))),
    ).toThrow('Example.update: argument "first"');
    expect(() => method.decodeArgs(new Uint8Array())).toThrow(
      ContractDecodeError,
    );
  });

  it("rejects trailing calldata", () => {
    const data = method.invocation(address, gasAmount(1n), {
      first: -4n,
      second: 300n,
    }).calldata;
    expect(() => method.decodeArgs(new Uint8Array([...data, 0]))).toThrow(
      "Example.update: 1 trailing calldata bytes",
    );
  });

  it("returns undefined only for valid no-argument calldata", () => {
    expect(ERC20.v0_1.getBalance.decodeArgs(new Uint8Array())).toBeUndefined();
    expect(() => ERC20.v0_1.getBalance.decodeArgs(new Uint8Array([0]))).toThrow(
      ContractDecodeError,
    );
  });

  it("decodes generated compound wallet arguments through a bound descriptor", () => {
    const transfer = ERC20.v0_1.transfer.invocation(address, gasAmount(100n), {
      receiver: caller,
      amount: 42n,
    });
    const calls = [
      {
        target: transfer.invoked_address,
        entrypoint: transfer.entrypoint,
        gas_limit: transfer.gas_limit,
        calldata: transfer.calldata,
      },
    ];
    const root = DefaultWallet.v0_1.execute.invocation(
      address,
      gasAmount(200n),
      {
        calls,
      },
    );
    const wallet = getContract({
      binding: DefaultWallet.v0_1,
      address: address,
      client: clientReturning({
        output: { result: "fault" },
        stateBlockHeight: 0n,
        gasUsed: 42n,
        events: [],
      }),
    });
    expect(wallet.execute.decodeArgs(root.calldata)).toEqual({ calls });
    expect(ERC20.v0_1.transfer.decodeArgs(transfer.calldata)).toEqual({
      receiver: caller,
      amount: 42n,
    });
  });

  it("creates own properties for prototype-like argument names", () => {
    const special = defineContractMethod<Record<string, bigint>, void, never>(
      definition({
        args: [
          {
            abiName: "__proto__",
            publicName: "__proto__",
            type: { v: ContractTypeKind.U32 },
          },
        ],
      }),
    );
    const args = special.decodeArgs(encode((writer) => writer.writeUint32(7n)));
    expect(Object.hasOwn(args, "__proto__")).toBe(true);
    expect(args.__proto__).toBe(7n);
    expect(Object.getPrototypeOf(args)).toBe(Object.prototype);
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

  it("decodes return and declared abort payloads beyond the former 1024-byte limit", () => {
    const descriptor = defineContractMethod<void, Uint8Array, unknown>(
      definition({
        args: [],
        returnType: { v: ContractTypeKind.Bytes },
        throws: [
          {
            selector: 7n,
            name: "LargeFailure",
            type: { v: ContractTypeKind.Bytes },
          },
        ],
      }),
    );
    const value = new Uint8Array(2048).fill(0x2a);
    const returned = encode((writer) =>
      writer.writeVarOpaque(value, 0xffffffff),
    );
    const aborted = encode((writer) => {
      writer.writeUint64(7n);
      writer.writeVarOpaque(value, 0xffffffff);
    });
    expect(descriptor.decodeReturn(returned)).toEqual(value);
    expect(descriptor.decodeException(aborted)).toEqual({
      kind: "declared",
      selector: 7n,
      name: "LargeFailure",
      value,
    });
    expect(
      descriptor.decodeReceiptOutcome(
        receipt({ execution: { result: "return", returnData: returned } }),
      ),
    ).toMatchObject({
      kind: "return",
      value,
    });
    expect(
      descriptor.decodeViewOutcome({
        output: { result: "return", returnData: returned },
        stateBlockHeight: 1n,
        gasUsed: 1n,
        events: [],
      }),
    ).toMatchObject({ kind: "return", value });
    expect(() =>
      descriptor.decodeReturn(returned.subarray(0, returned.length - 1)),
    ).toThrow(ContractDecodeError);
    expect(() =>
      descriptor.decodeException(aborted.subarray(0, aborted.length - 1)),
    ).toThrow(ContractDecodeError);
  });

  it("preserves unknown abort payloads beyond the former buffer limit", () => {
    const data = encode((writer) => {
      writer.writeUint64(99n);
      writer.writeFixedOpaque(new Uint8Array(2048).fill(0x2a), 2048);
    });
    expect(method.decodeException(data)).toEqual({
      kind: "unknown",
      selector: 99n,
      data,
    });
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

describe("contract method receipts", () => {
  const method = defineContractMethod<unknown, bigint, unknown>(definition());

  it("decodes successful receipts and preserves commit metadata", () => {
    const committed = receipt({
      execution: {
        result: "return",
        returnData: encode((writer) => writer.writeInt64(42n)),
      },
    });

    expect(method.decodeReceiptOutcome(committed)).toEqual({
      kind: "return",
      value: 42n,
      transactionHash: txHash,
      blockHeight: 12n,
      events,
    });
    expect(method.decodeReceipt(committed)).toEqual({
      value: 42n,
      transactionHash: txHash,
      blockHeight: 12n,
      events,
    });
  });

  it("decodes empty native return data for void methods", () => {
    const voidMethod = defineContractMethod<void, void, never>(
      definition({
        args: [],
        returnType: { v: ContractTypeKind.Void },
        throws: [],
      }),
    );

    expect(voidMethod.decodeReceipt(receipt())).toEqual({
      value: undefined,
      transactionHash: txHash,
      blockHeight: 12n,
      events,
    });
  });

  it("decodes root-frame aborts as typed outcomes", () => {
    const abortData = encode((writer) => {
      writer.writeUint64(7n);
      writer.writeInt32(-9n);
    });
    const reverted = receipt({
      execution: { result: "abort", abortData },
    });

    expect(method.decodeReceiptOutcome(reverted)).toEqual({
      kind: "abort",
      exception: {
        kind: "declared",
        selector: 7n,
        name: "BadValue",
        value: -9n,
      },
      abortData,
      transactionHash: txHash,
      blockHeight: 12n,
      events,
    });
    expect(() => method.decodeReceipt(reverted)).toThrowError(
      ContractReceiptError,
    );
  });

  it("preserves faults and rejects truncated successful return bytes", () => {
    const failed = receipt({ execution: { result: "fault" } });
    expect(method.decodeReceiptOutcome(failed)).toMatchObject({
      kind: "failure",
      execution: { result: "fault" },
    });
    expect(() => method.decodeReceipt(failed)).toThrow(ContractReceiptError);
    expect(() => method.decodeReceipt(receipt())).toThrow(ContractDecodeError);
  });
});

describe("contract method views", () => {
  const method = defineContractMethod<
    { first: bigint; second: bigint },
    bigint,
    unknown
  >(definition());

  it("returns decoded values and forwards arguments, caller, and auth", async () => {
    const assumedAuth: AuthClaim = {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(5n),
        required_weight: weight(3n),
      },
    };
    const client = clientReturning({
      output: {
        result: "return",
        returnData: encode((writer) => writer.writeInt64(-8n)),
      },
      stateBlockHeight: 12n,
      gasUsed: 42n,
      events,
    });

    await expect(
      method.viewOutcome({
        client,
        address,
        caller,
        assumedAuth,
        args: { first: -2n, second: 5n },
      }),
    ).resolves.toEqual({
      kind: "return",
      value: -8n,
      stateBlockHeight: 12n,
      gasUsed: 42n,
      events,
    });
    expect(client.simulateInvocation).toHaveBeenCalledWith({
      address,
      entrypoint,
      caller,
      assumedAuth: { kind: "sourceAddress", allowedKeys: 5, requiredWeight: 3 },
      calldata: expect.any(Uint8Array),
    });
  });

  it("snapshots authorization when preparing a view", () => {
    const assumedAuth: AuthClaim = {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(5n),
        required_weight: weight(3n),
      },
    };
    const expected = {
      kind: "sourceAddress",
      allowedKeys: 5,
      requiredWeight: 3,
    };
    const prepared = method.viewRequest({
      address,
      args: { first: 1n, second: 2n },
      assumedAuth,
    });
    assumedAuth.source_address_claim.allowed_keys = bitMap(1n);
    expect(prepared.request.assumedAuth).toEqual(expected);
  });

  it("the ergonomic view resolves successful return metadata", async () => {
    const client = clientReturning({
      output: {
        result: "return",
        returnData: encode((writer) => writer.writeInt64(17n)),
      },
      stateBlockHeight: 13n,
      gasUsed: 42n,
      events,
    });

    expect(method.decodeView(await client.simulateInvocation()).gasUsed).toBe(
      42n,
    );

    await expect(
      method.view({
        client,
        address,
        args: { first: 1n, second: 2n },
      }),
    ).resolves.toEqual({
      value: 17n,
      stateBlockHeight: 13n,
      gasUsed: 42n,
      events,
    });
  });

  it("returns declared exceptions and fault outcomes without throwing", async () => {
    const abortData = encode((writer) => {
      writer.writeUint64(7n);
      writer.writeInt32(-1n);
    });
    const abortClient = clientReturning({
      output: { result: "abort", abortData },
      stateBlockHeight: 20n,
      gasUsed: 42n,
      events,
    });
    const faultClient = clientReturning({
      output: { result: "fault" },
      stateBlockHeight: 21n,
      gasUsed: 42n,
      events,
    });
    const args = { first: 1n, second: 2n };

    await expect(
      method.viewOutcome({ client: abortClient, address, args }),
    ).resolves.toEqual({
      kind: "abort",
      exception: {
        kind: "declared",
        selector: 7n,
        name: "BadValue",
        value: -1n,
      },
      abortData,
      stateBlockHeight: 20n,
      gasUsed: 42n,
      events,
    });
    await expect(
      method.viewOutcome({ client: faultClient, address, args }),
    ).resolves.toEqual({
      kind: "fault",
      stateBlockHeight: 21n,
      gasUsed: 42n,
      events,
    });
  });

  it("returns unknown exceptions in abort outcomes losslessly", async () => {
    const abortData = encode((writer) => writer.writeUint64(88n));
    const client = clientReturning({
      output: { result: "abort", abortData },
      stateBlockHeight: 30n,
      gasUsed: 42n,
      events,
    });

    await expect(
      method.viewOutcome({
        client,
        address,
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
        stateBlockHeight: 1n,
        gasUsed: 42n,
        events,
      });

      const promise = method.view({
        client,
        address,
        args: { first: 1n, second: 2n },
      });
      await expect(promise).rejects.toBeInstanceOf(ContractViewError);
      await expect(promise).rejects.toMatchObject({
        outcome: { kind: result, gasUsed: 42n },
      });
    },
  );

  it("propagates client failures without wrapping them", async () => {
    const failure = new Error("gateway unavailable");
    const client = {
      simulateInvocation: vi.fn(async () => {
        throw failure;
      }),
    } satisfies Pick<ThruputClient, "simulateInvocation">;

    await expect(
      method.viewOutcome({
        client,
        address,
        args: { first: 1n, second: 2n },
      }),
    ).rejects.toBe(failure);
  });
});
