import { describe, expect, it } from "vitest";
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
};

describe("encodeCalldata", () => {
  it("encodes transfer(address, u128) and decodes back", () => {
    const to = contractAddress(new Uint8Array(32).fill(0xab));
    const amount = 1000n;

    const data = encodeCalldata(erc20Spec, "ERC20", "transfer", [to, amount]);
    const decoded = decodeCalldata(erc20Spec, "ERC20", "transfer", data);

    expect(decoded.to).toEqual(to);
    expect(decoded.amount).toBe(amount);
  });

  it("encodes get_balance() with no args", () => {
    const data = encodeCalldata(erc20Spec, "ERC20", "get_balance", []);

    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(0);
  });

  it("throws on wrong arg count", () => {
    expect(() => encodeCalldata(erc20Spec, "ERC20", "transfer", [])).toThrow(
      'Expected 2 args for "transfer", got 0',
    );
  });

  it("throws on unknown method", () => {
    expect(() => encodeCalldata(erc20Spec, "ERC20", "nonexistent", [])).toThrow(
      'Method "nonexistent" not found',
    );
  });

  it("throws on unknown interface", () => {
    expect(() => encodeCalldata(erc20Spec, "Unknown", "transfer", [])).toThrow(
      'Interface "Unknown" not found',
    );
  });
});

describe("decodeCalldata", () => {
  it("decodes get_balance_of(address) round-trip", () => {
    const addr = contractAddress(new Uint8Array(32).fill(0xcc));
    const data = encodeCalldata(erc20Spec, "ERC20", "get_balance_of", [addr]);
    const decoded = decodeCalldata(erc20Spec, "ERC20", "get_balance_of", data);

    expect(decoded.addr).toEqual(addr);
  });

  it("decodes empty calldata for no-arg methods", () => {
    const data = encodeCalldata(erc20Spec, "ERC20", "get_balance", []);
    const decoded = decodeCalldata(erc20Spec, "ERC20", "get_balance", data);

    expect(decoded).toEqual({});
  });

  it("throws on trailing data", () => {
    const to = contractAddress(new Uint8Array(32).fill(0xab));
    const amount = 1000n;
    const data = encodeCalldata(erc20Spec, "ERC20", "transfer", [to, amount]);

    const padded = new Uint8Array(data.length + 5);
    padded.set(data);
    padded.set([0xff, 0xff, 0xff, 0xff, 0xff], data.length);

    expect(() =>
      decodeCalldata(erc20Spec, "ERC20", "transfer", padded),
    ).toThrow("Trailing data");
  });
});

describe("buildNamedCodecs", () => {
  it("generates a working codec for an enum type", () => {
    const codecs = buildNamedCodecs(erc20Spec.type_defs);

    expect(codecs["ERC20Error"]).toBeDefined();

    const enumCodec = codecs["ERC20Error"];
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

    const owner = contractAddress(new Uint8Array(32).fill(0x01));
    const original = { owner, supply: 999n, frozen: true };

    const w = new CxsWriter();
    structCodec.encode(w, original);
    const bytes = w.finish();

    const r = new CxsReader(bytes);
    const decoded = structCodec.decode(r) as typeof original;

    expect(decoded.owner).toEqual(owner);
    expect(decoded.supply).toBe(999n);
    expect(decoded.frozen).toBe(true);
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

    // Test tuple case
    const okVal = { discriminant: 0n, value: [42n] };
    const w1 = new CxsWriter();
    unionCodec.encode(w1, okVal);
    const decoded1 = unionCodec.decode(new CxsReader(w1.finish()));
    expect(decoded1).toEqual(okVal);

    // Test void case
    const errVal = { discriminant: 1n };
    const w2 = new CxsWriter();
    unionCodec.encode(w2, errVal);
    const decoded2 = unionCodec.decode(new CxsReader(w2.finish()));
    expect(decoded2).toEqual(errVal);

    // Test struct case
    const detailVal = {
      discriminant: 2n,
      value: { code: 404n, msg: "not found" },
    };
    const w3 = new CxsWriter();
    unionCodec.encode(w3, detailVal);
    const decoded3 = unionCodec.decode(new CxsReader(w3.finish()));
    expect(decoded3).toEqual(detailVal);
  });
});
