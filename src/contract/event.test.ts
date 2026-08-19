import { describe, expect, it } from "vitest";
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
    ).toThrow("FixedBytes expected length 32, got 31");
    expect(() =>
      defineContractEvent(
        definition({
          topics: [
            ...definition().topics,
            {
              name: "extra",
              type: { v: ContractTypeKind.U32 },
              representation: "hash",
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
    ).toThrow("FixedBytes expected length 32, got 31");
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
    ).toThrow("FixedBytes expected length 32, got 31");
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
