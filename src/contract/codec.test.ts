import { describe, expect, it } from "vitest";
import { CxsWriter, Int32Codec } from "@groundhogchain/protocol";
import {
  contractSpecString,
  ContractTypeDefKind,
  ContractTypeKind,
  ContractUnionCaseKind,
} from "@groundhogchain/contract-spec";
import {
  createContractCodec,
  createContractCodecContext,
  resolveContextCodec,
  type ContractCodecContext,
} from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import type { FixedArray } from "./fixed.js";
import type { ContractTypeDef } from "./spec.js";

const s = contractSpecString;

const signedTypes: ContractTypeDef[] = [
  {
    v: ContractTypeDefKind.TypeDefEnum,
    enum_def: {
      name: s("SignedEnum"),
      variants: [
        { name: s("Negative"), value: -7n },
        { name: s("Positive"), value: 9n },
      ],
    },
  },
  {
    v: ContractTypeDefKind.TypeDefUnion,
    union_def: {
      name: s("SignedUnion"),
      cases: [
        {
          name: s("Negative"),
          discriminant: -3n,
          case_type: {
            v: ContractUnionCaseKind.UnionCaseTuple,
            tuple: [{ v: ContractTypeKind.I32 }],
          },
        },
        {
          name: s("Positive"),
          discriminant: 4n,
          case_type: { v: ContractUnionCaseKind.UnionCaseVoid },
        },
      ],
    },
  },
];

describe("contract codecs", () => {
  it("round-trips values through a complete-input codec", () => {
    const context = createContractCodecContext([]);
    const codec = createContractCodec<bigint>(
      context,
      { v: ContractTypeKind.I64 },
      "signed amount",
    );

    expect(codec.decode(codec.encode(-123n))).toBe(-123n);
  });

  it("rejects trailing bytes with the requested label", () => {
    const codec = createContractCodec<bigint>(
      createContractCodecContext([]),
      { v: ContractTypeKind.I32 },
      "signed amount",
    );
    const encoded = codec.encode(-1n);
    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);

    expect(() => codec.decode(trailing)).toThrowError(ContractDecodeError);
    expect(() => codec.decode(trailing)).toThrow(
      /Failed to decode signed amount: 1 trailing bytes/,
    );
  });

  it("rejects malformed input as a contract decode error with its cause", () => {
    const codec = createContractCodec<bigint>(createContractCodecContext([]), {
      v: ContractTypeKind.I128,
    });

    try {
      codec.decode(new Uint8Array());
      throw new Error("expected decode to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ContractDecodeError);
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  it("rejects malformed UTF-8 strings", () => {
    const codec = createContractCodec<string>(createContractCodecContext([]), {
      v: ContractTypeKind.String,
    });

    expect(() => codec.decode(Uint8Array.of(1, 0xff))).toThrowError(
      ContractDecodeError,
    );
  });

  it("rejects unpaired UTF-16 surrogates before string encoding", () => {
    const codec = createContractCodec<string>(createContractCodecContext([]), {
      v: ContractTypeKind.String,
    });

    expect(() => codec.encode("\ud800")).toThrow(
      "String contains an unpaired UTF-16 surrogate",
    );
    expect(codec.decode(codec.encode("Groundhog \ud83e\udd94"))).toBe(
      "Groundhog \ud83e\udd94",
    );
  });

  it("rejects forged codec contexts", () => {
    expect(() =>
      resolveContextCodec({} as ContractCodecContext, {
        v: ContractTypeKind.U32,
      }),
    ).toThrow("Invalid ContractCodecContext");
  });

  it("returns immutable fixed arrays and rejects incorrect input lengths", () => {
    const codec = createContractCodec<FixedArray<bigint, 2>>(
      createContractCodecContext([]),
      {
        v: ContractTypeKind.Array,
        array: { element: { v: ContractTypeKind.U32 }, len: 2n },
      },
    );

    const decoded = codec.decode(codec.encode([1n, 2n]));
    expect(decoded).toEqual([1n, 2n]);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(() => codec.encode([1n] as never)).toThrow(
      "FixedArray expected 2 elements, got 1",
    );
  });

  it("uses Uint8Array for variable U8 containers", () => {
    const codec = createContractCodec<Uint8Array>(
      createContractCodecContext([]),
      {
        v: ContractTypeKind.Vector,
        vector: { element: { v: ContractTypeKind.U8 }, max_len: 4n },
      },
    );

    const value = Uint8Array.of(1, 2, 255);
    expect(codec.decode(codec.encode(value))).toEqual(value);
    // Generated independently with the CXS serializer used by hogexec.
    expect(codec.encode(Uint8Array.of(0xde, 0xad, 0xbe, 0xef))).toEqual(
      Uint8Array.of(0x04, 0xde, 0xad, 0xbe, 0xef),
    );
    expect(() => codec.encode([1n, 2n] as never)).toThrow(
      "Expected Uint8Array",
    );
  });
});

describe("signed enum and union codecs", () => {
  const context = createContractCodecContext(signedTypes);
  const signedEnum = createContractCodec<bigint>(context, {
    v: ContractTypeKind.Named,
    named: s("SignedEnum"),
  });
  const signedUnion = createContractCodec<
    { case: "Negative"; value: [bigint] } | { case: "Positive" }
  >(context, {
    v: ContractTypeKind.Named,
    named: s("SignedUnion"),
  });

  it("round-trips declared negative enum values", () => {
    expect(signedEnum.decode(signedEnum.encode(-7n))).toBe(-7n);
  });

  it("rejects undeclared enum values when encoding and decoding", () => {
    expect(() => signedEnum.encode(-8n)).toThrow(
      'Unknown value -8 for enum "SignedEnum"',
    );

    const writer = new CxsWriter();
    Int32Codec.encode(writer, -8n);
    expect(() => signedEnum.decode(writer.finish())).toThrow(
      /Unknown value -8 for enum "SignedEnum"/,
    );
  });

  it("round-trips negative discriminants and signed case values", () => {
    const value: { case: "Negative"; value: [bigint] } = {
      case: "Negative",
      value: [-99n],
    };

    expect(signedUnion.decode(signedUnion.encode(value))).toEqual(value);
  });

  it("rejects undeclared union cases and discriminants", () => {
    expect(() => signedUnion.encode({ case: "Missing" } as never)).toThrow(
      'Unknown case Missing for union "SignedUnion"',
    );

    const writer = new CxsWriter();
    writer.writeInt32(-4n);
    expect(() => signedUnion.decode(writer.finish())).toThrow(
      /Unknown discriminant -4 for union "SignedUnion"/,
    );
  });
});
