import { assert, describe, expect, it } from "vitest";
import {
  contractAddress,
  CxsReader,
  CxsWriter,
  codec,
  Uint128Codec,
  Uint32Codec,
} from "@groundhogchain/protocol";
import {
  contractSpecString,
  ContractTypeKind,
  ContractTypeDefKind,
  ContractUnionCaseKind,
} from "@groundhogchain/contract-spec";
import type { ContractSpec, ContractTypeDef } from "./spec.js";
import { encodeCalldata, decodeCalldata } from "./encode.js";
import { buildNamedCodecs } from "./codegen.js";

const s = contractSpecString;

const erc20Spec: ContractSpec = {
  interfaces: [
    {
      name: s("ERC20"),
      vers: s("0.1.0"),
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          ty: { v: ContractTypeKind.Named, named: s("ERC20Error") },
        },
      ],
      methods: [
        {
          name: s("transfer"),
          args: [
            { name: s("to"), ty: { v: ContractTypeKind.Address } },
            { name: s("amount"), ty: { v: ContractTypeKind.U128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("get_balance"),
          args: [],
          return_type: { v: ContractTypeKind.U128 },
        },
        {
          name: s("get_balance_of"),
          args: [{ name: s("addr"), ty: { v: ContractTypeKind.Address } }],
          return_type: { v: ContractTypeKind.U128 },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: s("ERC20Error"),
        variants: [
          { name: s("AlreadyInitialized"), value: 1n },
          { name: s("MustBeContractOwner"), value: 2n },
          { name: s("TooLarge"), value: 3n },
          { name: s("Internal"), value: 100n },
        ],
      },
    },
  ],
  events: [],
};

const erc20Codecs = buildNamedCodecs(erc20Spec.type_defs);

describe("encodeCalldata", () => {
  it("encodes transfer(address, u128) and decodes back", () => {
    const to = contractAddress(new Uint8Array(32).fill(0xab));
    const amount = 1000n;

    const data = encodeCalldata(
      erc20Spec,
      "ERC20",
      "transfer",
      [to, amount],
      erc20Codecs,
    );
    const decoded = decodeCalldata(
      erc20Spec,
      "ERC20",
      "transfer",
      data,
      erc20Codecs,
    );

    expect(decoded.to).toEqual(to);
    expect(decoded.amount).toBe(amount);
  });

  it("encodes get_balance() with no args", () => {
    const data = encodeCalldata(
      erc20Spec,
      "ERC20",
      "get_balance",
      [],
      erc20Codecs,
    );

    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(0);
  });

  it("throws on wrong arg count", () => {
    expect(() =>
      encodeCalldata(erc20Spec, "ERC20", "transfer", [], erc20Codecs),
    ).toThrow('Expected 2 args for "transfer", got 0');
  });

  it("rejects arguments inherited through the array prototype", () => {
    const args = Array<unknown>(2);
    Object.setPrototypeOf(args, {
      0: contractAddress(new Uint8Array(32).fill(0xab)),
      1: 1000n,
    });

    expect(() =>
      encodeCalldata(erc20Spec, "ERC20", "transfer", args, erc20Codecs),
    ).toThrow("Array requires own value at index 0");
  });

  it("throws on unknown method", () => {
    expect(() =>
      encodeCalldata(erc20Spec, "ERC20", "nonexistent", [], erc20Codecs),
    ).toThrow('Method "nonexistent" not found');
  });

  it("throws on unknown interface", () => {
    expect(() =>
      encodeCalldata(erc20Spec, "Unknown", "transfer", [], erc20Codecs),
    ).toThrow('Interface "Unknown" not found');
  });
});

describe("decodeCalldata", () => {
  it("decodes get_balance_of(address) round-trip", () => {
    const addr = contractAddress(new Uint8Array(32).fill(0xcc));
    const data = encodeCalldata(
      erc20Spec,
      "ERC20",
      "get_balance_of",
      [addr],
      erc20Codecs,
    );
    const decoded = decodeCalldata(
      erc20Spec,
      "ERC20",
      "get_balance_of",
      data,
      erc20Codecs,
    );

    expect(decoded.addr).toEqual(addr);
  });

  it("decodes empty calldata for no-arg methods", () => {
    const data = encodeCalldata(
      erc20Spec,
      "ERC20",
      "get_balance",
      [],
      erc20Codecs,
    );
    const decoded = decodeCalldata(
      erc20Spec,
      "ERC20",
      "get_balance",
      data,
      erc20Codecs,
    );

    expect(decoded).toEqual({});
  });

  it("throws on trailing data", () => {
    const to = contractAddress(new Uint8Array(32).fill(0xab));
    const amount = 1000n;
    const data = encodeCalldata(
      erc20Spec,
      "ERC20",
      "transfer",
      [to, amount],
      erc20Codecs,
    );

    const padded = new Uint8Array(data.length + 5);
    padded.set(data);
    padded.set([0xff, 0xff, 0xff, 0xff, 0xff], data.length);

    expect(() =>
      decodeCalldata(erc20Spec, "ERC20", "transfer", padded, erc20Codecs),
    ).toThrow("Trailing data");
  });
});

const rgbSpec: ContractSpec = {
  interfaces: [
    {
      name: s("RGB"),
      vers: s("0.1.0"),
      throws: [],
      methods: [
        {
          name: s("set_pixel"),
          args: [
            { name: s("x"), ty: { v: ContractTypeKind.U32 } },
            { name: s("y"), ty: { v: ContractTypeKind.U32 } },
            { name: s("r"), ty: { v: ContractTypeKind.U8 } },
            { name: s("g"), ty: { v: ContractTypeKind.U8 } },
            { name: s("b"), ty: { v: ContractTypeKind.U8 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("set_pixel_rgba"),
          args: [
            { name: s("x"), ty: { v: ContractTypeKind.U32 } },
            { name: s("y"), ty: { v: ContractTypeKind.U32 } },
            {
              name: s("color"),
              ty: {
                v: ContractTypeKind.Array,
                array: {
                  element: { v: ContractTypeKind.U8 },
                  len: 4n,
                },
              },
            },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
      ],
    },
  ],
  type_defs: [],
  events: [],
};

const rgbCodecs = buildNamedCodecs(rgbSpec.type_defs);

describe("U8 codec", () => {
  it("encodes and decodes u8 values", () => {
    const data = encodeCalldata(
      rgbSpec,
      "RGB",
      "set_pixel",
      [10n, 20n, 255n, 0n, 128n],
      rgbCodecs,
    );
    const decoded = decodeCalldata(
      rgbSpec,
      "RGB",
      "set_pixel",
      data,
      rgbCodecs,
    );

    expect(decoded.x).toBe(10n);
    expect(decoded.y).toBe(20n);
    expect(decoded.r).toBe(255n);
    expect(decoded.g).toBe(0n);
    expect(decoded.b).toBe(128n);
  });

  it("encodes u8 as a single byte", () => {
    const data = encodeCalldata(
      rgbSpec,
      "RGB",
      "set_pixel",
      [0n, 0n, 42n, 0n, 0n],
      rgbCodecs,
    );
    // 2 u32 args (variable-length CXS) + 3 u8 args (1 byte each)
    // u32 CXS for 0 = 1 byte, so: 1 + 1 + 1 + 1 + 1 = 5 bytes
    expect(data.length).toBe(5);
  });

  it("throws on u8 value > 255", () => {
    expect(() =>
      encodeCalldata(
        rgbSpec,
        "RGB",
        "set_pixel",
        [0n, 0n, 256n, 0n, 0n],
        rgbCodecs,
      ),
    ).toThrow("uint8 overflow: 256");
  });

  it("throws on negative u8 value", () => {
    expect(() =>
      encodeCalldata(
        rgbSpec,
        "RGB",
        "set_pixel",
        [0n, 0n, -1n, 0n, 0n],
        rgbCodecs,
      ),
    ).toThrow("uint8 overflow: -1");
  });

  it("encodes and decodes a [u8; 4] fixed array", () => {
    const color = Uint8Array.of(255, 128, 0, 200);
    const data = encodeCalldata(
      rgbSpec,
      "RGB",
      "set_pixel_rgba",
      [5n, 10n, color],
      rgbCodecs,
    );
    const decoded = decodeCalldata(
      rgbSpec,
      "RGB",
      "set_pixel_rgba",
      data,
      rgbCodecs,
    );

    expect(decoded.x).toBe(5n);
    expect(decoded.y).toBe(10n);
    expect(decoded.color).toEqual(color);
  });

  it("[u8; 4] wire format is exactly 4 bytes for the array", () => {
    const color = new Uint8Array(4);
    const data = encodeCalldata(
      rgbSpec,
      "RGB",
      "set_pixel_rgba",
      [0n, 0n, color],
      rgbCodecs,
    );
    // 2 u32 CXS(0) = 1 byte each, + 4 u8 = 4 bytes = 6 total
    expect(data.length).toBe(6);
  });
});

const signedSpec: ContractSpec = {
  interfaces: [
    {
      name: s("SignedMath"),
      vers: s("0.1.0"),
      throws: [],
      methods: [
        {
          name: s("compute"),
          args: [
            { name: s("a"), ty: { v: ContractTypeKind.I32 } },
            { name: s("b"), ty: { v: ContractTypeKind.I128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
      ],
    },
  ],
  type_defs: [],
  events: [],
};

const signedCodecs = buildNamedCodecs(signedSpec.type_defs);

describe("signed integer codecs", () => {
  it("round-trips negative I32 values", () => {
    const data = encodeCalldata(
      signedSpec,
      "SignedMath",
      "compute",
      [-1n, 0n],
      signedCodecs,
    );
    const decoded = decodeCalldata(
      signedSpec,
      "SignedMath",
      "compute",
      data,
      signedCodecs,
    );
    expect(decoded.a).toBe(-1n);
    expect(decoded.b).toBe(0n);
  });

  it("round-trips large negative I128 values", () => {
    const largeNeg = -(2n ** 127n);
    const data = encodeCalldata(
      signedSpec,
      "SignedMath",
      "compute",
      [0n, largeNeg],
      signedCodecs,
    );
    const decoded = decodeCalldata(
      signedSpec,
      "SignedMath",
      "compute",
      data,
      signedCodecs,
    );
    expect(decoded.a).toBe(0n);
    expect(decoded.b).toBe(largeNeg);
  });

  it("round-trips max positive I128", () => {
    const maxPos = 2n ** 127n - 1n;
    const data = encodeCalldata(
      signedSpec,
      "SignedMath",
      "compute",
      [2147483647n, maxPos],
      signedCodecs,
    );
    const decoded = decodeCalldata(
      signedSpec,
      "SignedMath",
      "compute",
      data,
      signedCodecs,
    );
    expect(decoded.a).toBe(2147483647n);
    expect(decoded.b).toBe(maxPos);
  });
});

describe("buildNamedCodecs", () => {
  it("generates a working codec for an enum type", () => {
    const codecs = buildNamedCodecs(erc20Spec.type_defs);

    expect(codecs["ERC20Error"]).toBeDefined();

    const enumCodec = codecs["ERC20Error"];
    assert.isDefined(enumCodec);
    const w = new CxsWriter();
    enumCodec.encode(w, 3n);
    const bytes = w.finish();

    const r = new CxsReader(bytes);
    const decoded = Uint32Codec.decode(r);
    expect(decoded).toBe(3n);
  });

  it("generates a working codec for a struct type", () => {
    const typeDefs: ContractTypeDef[] = [
      {
        v: ContractTypeDefKind.TypeDefStruct,
        struct_def: {
          name: s("TokenInfo"),
          fields: [
            { name: s("owner"), ty: { v: ContractTypeKind.Address } },
            { name: s("supply"), ty: { v: ContractTypeKind.U128 } },
            { name: s("frozen"), ty: { v: ContractTypeKind.Bool } },
          ],
        },
      },
    ];

    const codecs = buildNamedCodecs(typeDefs);
    const structCodec = codecs["TokenInfo"];
    assert.isDefined(structCodec);

    for (const invalid of [undefined, null, 1, "value", []]) {
      expect(() => structCodec.encode(new CxsWriter(), invalid)).toThrow(
        'Expected object for struct "TokenInfo"',
      );
    }

    const owner = contractAddress(new Uint8Array(32).fill(0x01));
    const original = { owner, supply: 999n, frozen: true };
    const inherited = Object.create(original) as typeof original;

    expect(() => structCodec.encode(new CxsWriter(), inherited)).toThrow(
      'Struct "TokenInfo" requires own property "owner"',
    );

    const w = new CxsWriter();
    structCodec.encode(w, original);
    const bytes = w.finish();

    const r = new CxsReader(bytes);
    const decoded = structCodec.decode(r) as typeof original;

    expect(decoded.owner).toEqual(owner);
    expect(decoded.supply).toBe(999n);
    expect(decoded.frozen).toBe(true);
  });

  it("supports ABI names that overlap object prototype properties", () => {
    const codecs = buildNamedCodecs([
      {
        v: ContractTypeDefKind.TypeDefStruct,
        struct_def: {
          name: s("__proto__"),
          fields: [{ name: s("__proto__"), ty: { v: ContractTypeKind.U32 } }],
        },
      },
    ]);
    const value: Record<string, unknown> = Object.create(null);
    value.__proto__ = 7n;
    const writer = new CxsWriter();

    const codec = codecs.__proto__;
    assert.isDefined(codec);
    codec.encode(writer, value);
    const decoded = codec.decode(new CxsReader(writer.finish())) as Record<
      string,
      unknown
    >;

    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded.__proto__).toBe(7n);
  });

  it("generates a working codec for a union type", () => {
    const typeDefs: ContractTypeDef[] = [
      {
        v: ContractTypeDefKind.TypeDefUnion,
        union_def: {
          name: s("Result"),
          cases: [
            {
              name: s("Ok"),
              discriminant: 0n,
              case_type: {
                v: ContractUnionCaseKind.UnionCaseTuple,
                tuple: [{ v: ContractTypeKind.U128 }],
              },
            },
            {
              name: s("Err"),
              discriminant: 1n,
              case_type: { v: ContractUnionCaseKind.UnionCaseVoid },
            },
            {
              name: s("Detail"),
              discriminant: 2n,
              case_type: {
                v: ContractUnionCaseKind.UnionCaseStruct,
                struct_fields: [
                  { name: s("code"), ty: { v: ContractTypeKind.U32 } },
                  { name: s("msg"), ty: { v: ContractTypeKind.String } },
                ],
              },
            },
          ],
        },
      },
    ];

    const codecs = buildNamedCodecs(typeDefs);
    const unionCodec = codecs["Result"];
    assert.isDefined(unionCodec);

    // Test tuple case
    const okVal = { case: "Ok", value: [42n] };
    const w1 = new CxsWriter();
    unionCodec.encode(w1, okVal);
    const decoded1 = unionCodec.decode(new CxsReader(w1.finish()));
    expect(decoded1).toEqual(okVal);

    // Test void case
    const errVal = { case: "Err" };
    const w2 = new CxsWriter();
    unionCodec.encode(w2, errVal);
    const decoded2 = unionCodec.decode(new CxsReader(w2.finish()));
    expect(decoded2).toEqual(errVal);

    // Test struct case
    const detailVal = {
      case: "Detail",
      value: { code: 404n, msg: "not found" },
    };
    const w3 = new CxsWriter();
    unionCodec.encode(w3, detailVal);
    const decoded3 = unionCodec.decode(new CxsReader(w3.finish()));
    expect(decoded3).toEqual(detailVal);

    const inheritedCase = Object.create(okVal) as typeof okVal;
    expect(() => unionCodec.encode(new CxsWriter(), inheritedCase)).toThrow(
      'Union "Result" requires own property "case"',
    );

    const inheritedTuple = Array<bigint>(1);
    Object.setPrototypeOf(inheritedTuple, { 0: 1n });
    expect(() =>
      unionCodec.encode(new CxsWriter(), {
        case: "Ok",
        value: inheritedTuple,
      }),
    ).toThrow("Tuple union case requires own value at index 0");

    const inheritedFields = {
      case: "Detail",
      value: Object.create(detailVal.value),
    };
    expect(() => unionCodec.encode(new CxsWriter(), inheritedFields)).toThrow(
      'Struct union case requires own property "code"',
    );
  });
});
