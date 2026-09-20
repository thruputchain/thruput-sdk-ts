import { describe, expect, expectTypeOf, it } from "vitest";
import { PingEvent } from "../../examples/generated/counter.js";
import {
  CxsWriter,
  contractAddress,
  kMaxEventLength,
} from "@groundhogchain/protocol";
import { ContractTypeKind } from "@groundhogchain/contract-spec";
import type { EmittedEvent } from "../types/rpc.js";
import { createContractCodecContext } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import { defineContractEvent, type ContractEventDefinition } from "./event.js";

const signature = new Uint8Array(32).fill(0x11);
const emitterA = contractAddress(new Uint8Array(32).fill(0xaa));
const emitterB = contractAddress(new Uint8Array(32).fill(0xbb));
const account = contractAddress(new Uint8Array(32).fill(0x22));
const id = new Uint8Array(32).fill(0x33);
const digest = new Uint8Array(32).fill(0x44);

function definition(
  overrides: Partial<ContractEventDefinition<"Changed">> = {},
): ContractEventDefinition<"Changed"> {
  return {
    name: "Changed",
    signature,
    topics: [
      {
        name: "account",
        type: { v: ContractTypeKind.Address },
        representation: "address",
      },
      {
        name: "id",
        type: {
          v: ContractTypeKind.Array,
          array: { element: { v: ContractTypeKind.U8 }, len: 32n },
        },
        representation: "fixedBytes32",
      },
    ],
    fields: [
      { name: "delta", type: { v: ContractTypeKind.I32 } },
      { name: "memo", type: { v: ContractTypeKind.String } },
    ],
    codecs: createContractCodecContext([]),
    ...overrides,
  };
}

function payload(delta = -5n, memo = "updated"): Uint8Array {
  const writer = new CxsWriter();
  writer.writeInt32(delta);
  writer.writeString(memo, 0xffffffff);
  return writer.finish();
}

function emitted(overrides: Partial<EmittedEvent> = {}): EmittedEvent {
  return {
    contractAddress: emitterA,
    topics: [signature, account, id],
    data: payload(),
    ...overrides,
  };
}

describe("contract event construction and decoding", () => {
  it("validates signature length and the protocol topic maximum", () => {
    expect(() =>
      defineContractEvent(definition({ signature: new Uint8Array(31) })),
    ).toThrow("FixedBytes expected 32 bytes, got 31");
    expect(() =>
      defineContractEvent(
        definition({
          topics: [
            ...definition().topics,
            {
              name: "extra",
              type: { v: ContractTypeKind.U32 },
              representation: "u32",
            },
          ],
        }),
      ),
    ).toThrow("declares 4 topics; protocol maximum is 3");
  });

  it("validates topic representations against their declared types", () => {
    expect(() =>
      defineContractEvent(
        definition({
          topics: [
            {
              name: "account",
              type: { v: ContractTypeKind.Address },
              representation: "hash",
            },
          ],
        }),
      ),
    ).toThrow(
      'Changed topic "account" representation "hash" does not match its declared type; expected "address"',
    );
  });

  it("returns independent signature copies", () => {
    const source = Buffer.alloc(32, 0x66);
    const descriptor = defineContractEvent(definition({ signature: source }));

    source.fill(0);
    descriptor.signature.fill(0);
    const filter = descriptor.filter({ contractAddresses: [emitterA] });
    filter.topics!.topic0![0]!.fill(0);

    expect(descriptor.signature).toEqual(new Uint8Array(32).fill(0x66));
    expect(
      descriptor.filter({ contractAddresses: [emitterA] }).topics!.topic0![0],
    ).toEqual(new Uint8Array(32).fill(0x66));
  });

  it("snapshots the event name", () => {
    const source = definition();
    const descriptor = defineContractEvent(source);
    (source as ContractEventDefinition).name = "Mutated";

    expect(descriptor.decode(emitted())).toMatchObject({ name: "Changed" });
  });

  it("returns null on signature mismatch before validating the event", () => {
    const descriptor = defineContractEvent(definition());

    expect(
      descriptor.decode({
        topics: [new Uint8Array(32)],
        data: new Uint8Array(),
      }),
    ).toBeNull();
  });

  it("strictly validates topic count", () => {
    const descriptor = defineContractEvent(definition());

    expect(() =>
      descriptor.decode({ topics: [signature, account], data: payload() }),
    ).toThrow(/expected 3 topics, got 2/);
    expect(() =>
      descriptor.decode({
        topics: [signature, account, id, digest],
        data: payload(),
      }),
    ).toThrow(/expected 3 topics, got 4/);
  });

  it("decodes semantic address and fixed-bytes topics with payload fields", () => {
    const descriptor = defineContractEvent<
      "Changed",
      { account: typeof account; id: Uint8Array },
      { delta: bigint; memo: string },
      never
    >(definition());

    expect(descriptor.decode(emitted())).toEqual({
      name: "Changed",
      topics: { account, id },
      fields: { delta: -5n, memo: "updated" },
    });
  });

  it("decodes prototype-like topic and field names as own properties", () => {
    const descriptor = defineContractEvent(
      definition({
        topics: [
          {
            name: "__proto__",
            type: { v: ContractTypeKind.Address },
            representation: "address",
          },
        ],
        fields: [{ name: "__proto__", type: { v: ContractTypeKind.U32 } }],
      }),
    );
    const writer = new CxsWriter();
    writer.writeUint32(7n);

    const decoded = descriptor.decode({
      topics: [signature, account],
      data: writer.finish(),
    });
    const topics = decoded!.topics as Record<string, unknown>;
    const fields = decoded!.fields as Record<string, unknown>;

    expect(Object.hasOwn(topics, "__proto__")).toBe(true);
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(topics.__proto__).toEqual(account);
    expect(fields.__proto__).toBe(7n);
  });

  it("rejects malformed topic lengths and payloads", () => {
    const descriptor = defineContractEvent(definition());

    const sparseTopics = new Array<Uint8Array>(3);
    sparseTopics[0] = signature;
    sparseTopics[2] = id;
    expect(() => descriptor.decode(emitted({ topics: sparseTopics }))).toThrow(
      'Failed to decode Changed: missing topic "account"',
    );

    expect(() =>
      descriptor.decode(emitted({ topics: [signature, account, id.slice(1)] })),
    ).toThrowError(ContractDecodeError);
    expect(() =>
      descriptor.decode(emitted({ data: new Uint8Array() })),
    ).toThrow(/Failed to decode Changed/);
  });

  it("rejects trailing payload bytes", () => {
    const descriptor = defineContractEvent(definition());
    const data = payload();
    const trailing = new Uint8Array(data.length + 1);
    trailing.set(data);

    expect(() => descriptor.decode(emitted({ data: trailing }))).toThrow(
      /1 trailing payload bytes/,
    );
  });

  it("enforces the serialized event size limit", () => {
    const descriptor = defineContractEvent(
      definition({
        topics: [],
        fields: [{ name: "value", type: { v: ContractTypeKind.Bytes } }],
      }),
    );
    const data = new Uint8Array(Number(kMaxEventLength) - signature.length + 1);

    expect(() => descriptor.decode({ topics: [signature], data })).toThrow(
      /serialized event size 1025 exceeds 1024 bytes/,
    );
  });
});

describe("contract event filters", () => {
  const descriptor = defineContractEvent<
    "Changed",
    unknown,
    unknown,
    {
      account?: typeof account | { oneOf: readonly (typeof account)[] };
      id?: Uint8Array | { oneOf: readonly Uint8Array[] };
    }
  >(definition());
  const numericDescriptor = defineContractEvent<
    "Numeric",
    { unsigned: bigint; signed: bigint },
    Record<string, never>,
    {
      unsigned?: bigint | { oneOf: readonly [bigint, ...bigint[]] };
      signed?: bigint | { oneOf: readonly [bigint, ...bigint[]] };
    }
  >({
    name: "Numeric",
    signature,
    topics: [
      {
        name: "unsigned",
        type: { v: ContractTypeKind.U256 },
        representation: "u256",
      },
      {
        name: "signed",
        type: { v: ContractTypeKind.I256 },
        representation: "i256",
      },
    ],
    fields: [],
    codecs: createContractCodecContext([]),
  });

  it("maps named direct topics and oneOf values to their ABI positions", () => {
    const otherAccount = contractAddress(new Uint8Array(32).fill(0x55));

    expect(
      descriptor.filter({
        contractAddresses: [emitterA, emitterB],
        topics: {
          account: { oneOf: [account, otherAccount] },
          id,
        },
      }),
    ).toEqual({
      contractAddresses: [emitterA, emitterB],
      topics: {
        topic0: [signature],
        topic1: [account, otherAccount],
        topic2: [id],
      },
    });
  });

  it("rejects missing or malformed emitter addresses", () => {
    expect(() => descriptor.filter({ contractAddresses: [] })).toThrow(
      "Changed filter requires a contract address",
    );
    expect(() =>
      descriptor.filter({
        contractAddresses: [new Uint8Array(31) as typeof emitterA],
      }),
    ).toThrow("FixedBytes expected 32 bytes, got 31");
    expect(() =>
      descriptor.filter({
        contractAddresses: Array(6).fill(emitterA),
      }),
    ).toThrow("Changed filter supports at most 5 contract addresses");
  });

  it("rejects unknown, empty, non-byte, and incorrectly sized topic inputs", () => {
    expect(() =>
      descriptor.filter({
        contractAddresses: [emitterA],
        topics: { missing: id } as never,
      }),
    ).toThrow('topic "missing" is not directly filterable');
    expect(() =>
      descriptor.filter({
        contractAddresses: [emitterA],
        topics: { id: { oneOf: [] } },
      }),
    ).toThrow('topic "id" oneOf must not be empty');
    expect(() =>
      descriptor.filter({
        contractAddresses: [emitterA],
        topics: { id: { oneOf: Array(17).fill(id) } },
      }),
    ).toThrow('topic "id" oneOf supports at most 16 values');
    expect(() =>
      descriptor.filter({
        contractAddresses: [emitterA],
        topics: { id: "not bytes" } as never,
      }),
    ).toThrow('topic "id" must be bytes');
    expect(() =>
      descriptor.filter({
        contractAddresses: [emitterA],
        topics: { id: new Uint8Array(31) },
      }),
    ).toThrow("FixedBytes expected 32 bytes, got 31");
  });

  it("rejects hash-represented topics as not directly filterable", () => {
    const hashDescriptor = defineContractEvent<
      "Changed",
      unknown,
      unknown,
      { digest: Uint8Array }
    >(
      definition({
        topics: [
          {
            name: "digest",
            type: { v: ContractTypeKind.Bytes },
            representation: "hash",
          },
        ],
        fields: [],
      }),
    );

    expect(() =>
      hashDescriptor.filter({
        contractAddresses: [emitterA],
        topics: { digest },
      }),
    ).toThrow('topic "digest" is not directly filterable');
  });

  it("decodes and filters direct U256 and I256 topics", () => {
    const unsigned = Uint8Array.from({ length: 32 }, (_, index) =>
      index === 31 ? 42 : 0,
    );
    const signed = new Uint8Array(32).fill(0xff);
    signed[31] = 0xfe;

    expect(
      numericDescriptor.decode({
        topics: [signature, unsigned, signed],
        data: new Uint8Array(),
      }),
    ).toEqual({
      name: "Numeric",
      topics: { unsigned: 42n, signed: -2n },
      fields: {},
    });
    expect(
      numericDescriptor.filter({
        contractAddresses: [emitterA],
        topics: { unsigned: 42n, signed: { oneOf: [-2n, -1n] } },
      }).topics,
    ).toEqual({
      topic0: [signature],
      topic1: [unsigned],
      topic2: [signed, new Uint8Array(32).fill(0xff)],
    });
  });

  it("adds topic context to numeric filter failures", () => {
    try {
      numericDescriptor.filter({
        contractAddresses: [emitterA],
        topics: { unsigned: "42" } as never,
      });
      throw new Error("expected filter to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'Numeric topic "unsigned" failed to encode: U256 expected bigint',
      );
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(((error as Error).cause as Error).message).toBe(
        "U256 expected bigint",
      );
    }
  });
});

describe("direct scalar topics (SDK sdk_rs#463 encoding)", () => {
  it("exposes bigint topics and filters through the regenerated Counter binding", () => {
    const bytes = new Uint8Array(32);
    bytes[31] = 42;
    const decoded = PingEvent.decode({
      topics: [PingEvent.signature, bytes],
      data: new Uint8Array(),
    });
    expectTypeOf(decoded!.topics.tag).toEqualTypeOf<bigint>();
    expect(decoded!.topics.tag).toBe(42n);
    expect(
      PingEvent.filter({ contractAddresses: [emitterA], topics: { tag: 42n } })
        .topics?.topic1,
    ).toEqual([bytes]);
  });
  const scalarTypes = [
    [ContractTypeKind.U32, "u32", 32, false],
    [ContractTypeKind.U64, "u64", 64, false],
    [ContractTypeKind.U128, "u128", 128, false],
    [ContractTypeKind.I32, "i32", 32, true],
    [ContractTypeKind.I64, "i64", 64, true],
    [ContractTypeKind.I128, "i128", 128, true],
  ] as const;

  // Independent big-endian reference, not the compact calldata/payload encoder.
  const topicBytes = (value: bigint) =>
    Uint8Array.from(
      BigInt.asUintN(256, value).toString(16).padStart(64, "0").match(/../g)!,
      (byte) => Number.parseInt(byte, 16),
    );

  it.each(scalarTypes)(
    "decodes and filters %s/%s within its declared range",
    (kind, representation, bits, signed) => {
      const descriptor = defineContractEvent(
        definition({
          topics: [{ name: "value", type: { v: kind }, representation }],
          fields: [],
        }),
      );
      const bound = 1n << BigInt(signed ? bits - 1 : bits);
      const min = signed ? -bound : 0n;
      const max = bound - 1n;
      // The positive and negative vectors also appear in the SDK scalar-topic test.
      const values = [0n, 0x0102_0304n, min, max, ...(signed ? [-2n] : [])];
      for (const value of values) {
        const bytes = topicBytes(value);
        expect(
          descriptor.decode({
            topics: [signature, bytes],
            data: new Uint8Array(),
          }),
        ).toMatchObject({ topics: { value } });
        expect(
          descriptor.filter({
            contractAddresses: [emitterA],
            topics: { value },
          }).topics?.topic1,
        ).toEqual([bytes]);
      }
      expect(
        descriptor.filter({
          contractAddresses: [emitterA],
          topics: { value: { oneOf: values } },
        }).topics?.topic1,
      ).toEqual(values.map(topicBytes));
      for (const value of [min - 1n, max + 1n]) {
        expect(() =>
          descriptor.filter({
            contractAddresses: [emitterA],
            topics: { value },
          }),
        ).toThrow();
        expect(() =>
          descriptor.decode({
            topics: [signature, topicBytes(value)],
            data: new Uint8Array(),
          }),
        ).toThrow(ContractDecodeError);
      }
      expect(() =>
        descriptor.filter({
          contractAddresses: [emitterA],
          topics: { value: 42 },
        }),
      ).toThrow(/expected bigint/);
    },
  );

  it("encodes booleans as padded 0/1 and rejects noncanonical values", () => {
    const descriptor = defineContractEvent(
      definition({
        topics: [
          {
            name: "enabled",
            type: { v: ContractTypeKind.Bool },
            representation: "bool",
          },
        ],
        fields: [],
      }),
    );
    for (const enabled of [false, true]) {
      const bytes = topicBytes(enabled ? 1n : 0n);
      expect(
        descriptor.decode({
          topics: [signature, bytes],
          data: new Uint8Array(),
        }),
      ).toMatchObject({ topics: { enabled } });
      expect(
        descriptor.filter({
          contractAddresses: [emitterA],
          topics: { enabled },
        }).topics?.topic1,
      ).toEqual([bytes]);
    }
    for (const value of [2n, 1n << 248n]) {
      expect(() =>
        descriptor.decode({
          topics: [signature, topicBytes(value)],
          data: new Uint8Array(),
        }),
      ).toThrow(ContractDecodeError);
    }
    for (const enabled of [0, 1n, "true"]) {
      expect(() =>
        descriptor.filter({
          contractAddresses: [emitterA],
          topics: { enabled },
        }),
      ).toThrow(/expected boolean/);
    }
  });

  it("rejects obsolete hashed scalar metadata rather than guessing an encoding", () => {
    expect(() =>
      defineContractEvent(
        definition({
          topics: [
            {
              name: "tag",
              type: { v: ContractTypeKind.U64 },
              representation: "hash",
            },
          ],
        }),
      ),
    ).toThrow('expected "u64"');
  });

  it.each([ContractTypeKind.String, ContractTypeKind.Bytes] as const)(
    "keeps variable-length topic type %s as an opaque, unfilterable hash",
    (kind) => {
      const descriptor = defineContractEvent(
        definition({
          topics: [{ name: "tag", type: { v: kind }, representation: "hash" }],
          fields: [],
        }),
      );
      expect(
        descriptor.decode({
          topics: [signature, digest],
          data: new Uint8Array(),
        }),
      ).toMatchObject({ topics: { tag: digest } });
      expect(() =>
        descriptor.filter({
          contractAddresses: [emitterA],
          topics: { tag: "short" },
        }),
      ).toThrow(/not directly filterable/);
    },
  );
});

describe("contract event receipt extraction", () => {
  const descriptor = defineContractEvent(definition());
  const matchingA = emitted();
  const matchingB = emitted({ contractAddress: emitterB });
  const malformedA = emitted({ data: new Uint8Array() });
  const malformedB = emitted({
    contractAddress: emitterB,
    data: new Uint8Array(),
  });
  const unrelated = emitted({ topics: [new Uint8Array(32), account, id] });
  const receipt = { events: [matchingA, unrelated, matchingB] };

  it("extracts matching events from the selected emitter", () => {
    expect(
      descriptor.allFromReceipt(receipt, { contractAddress: emitterB }),
    ).toHaveLength(1);
  });

  it("extracts exactly one scoped event", () => {
    expect(
      descriptor.singleFromReceipt(receipt, { contractAddress: emitterA }),
    ).toMatchObject({ name: "Changed" });
  });

  it("skips malformed matching signatures from other emitters", () => {
    expect(
      descriptor.allFromReceipt(
        { events: [malformedB, matchingA] },
        { contractAddress: emitterA },
      ),
    ).toHaveLength(1);
  });

  it("rejects malformed matching events from the selected emitter", () => {
    expect(() =>
      descriptor.allFromReceipt(
        { events: [malformedA] },
        { contractAddress: emitterA },
      ),
    ).toThrow(ContractDecodeError);
  });

  it("enforces zero and multiple match cardinality", () => {
    expect(() =>
      descriptor.singleFromReceipt(
        { events: [unrelated] },
        { contractAddress: emitterA },
      ),
    ).toThrow("Expected exactly one Changed event, got 0");
    expect(() =>
      descriptor.singleFromReceipt(
        { events: [matchingA, matchingA] },
        { contractAddress: emitterA },
      ),
    ).toThrow("Expected exactly one Changed event, got 2");
  });
});
