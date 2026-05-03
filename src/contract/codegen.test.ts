import { describe, expect, it } from "vitest";
import { CxsWriter, CxsReader } from "@groundhogchain/protocol";
import {
  contractSpecString,
  ContractTypeKind,
  ContractTypeDefKind,
} from "@groundhogchain/contract-spec";
import type { ContractTypeDef } from "./spec.js";
import { buildNamedCodecs } from "./codegen.js";

const s = contractSpecString;

describe("buildNamedCodecs with recursive types", () => {
  const typeDefs: ContractTypeDef[] = [
    {
      v: ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: s("Forest"),
        fields: [
          {
            name: s("trees"),
            ty: {
              v: ContractTypeKind.Vector,
              vector: {
                element: { v: ContractTypeKind.Named, named: s("Forest") },
                max_len: 4294967295n,
              },
            },
          },
          { name: s("label"), ty: { v: ContractTypeKind.U32 } },
        ],
      },
    },
    {
      v: ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: s("Tree"),
        fields: [
          { name: s("value"), ty: { v: ContractTypeKind.U32 } },
          {
            name: s("left"),
            ty: {
              v: ContractTypeKind.Option,
              option_inner: { v: ContractTypeKind.Named, named: s("Tree") },
            },
          },
          {
            name: s("right"),
            ty: {
              v: ContractTypeKind.Option,
              option_inner: { v: ContractTypeKind.Named, named: s("Tree") },
            },
          },
        ],
      },
    },
  ];

  it("round-trips a Tree with nested children", () => {
    const codecs = buildNamedCodecs(typeDefs);
    const treeCodec = codecs["Tree"];

    const tree = {
      value: 1n,
      left: {
        value: 2n,
        left: { value: 4n, left: null, right: null },
        right: null,
      },
      right: {
        value: 3n,
        left: null,
        right: { value: 5n, left: null, right: null },
      },
    };

    const w = new CxsWriter();
    treeCodec.encode(w, tree);
    const bytes = w.finish();

    const decoded = treeCodec.decode(new CxsReader(bytes));
    expect(decoded).toEqual(tree);
  });

  it("round-trips a leaf node (both children null)", () => {
    const codecs = buildNamedCodecs(typeDefs);
    const treeCodec = codecs["Tree"];

    const leaf = { value: 42n, left: null, right: null };

    const w = new CxsWriter();
    treeCodec.encode(w, leaf);
    const decoded = treeCodec.decode(new CxsReader(w.finish()));
    expect(decoded).toEqual(leaf);
  });

  it("round-trips a Forest with nested forests", () => {
    const codecs = buildNamedCodecs(typeDefs);
    const forestCodec = codecs["Forest"];

    const forest = {
      trees: [
        { trees: [], label: 10n },
        {
          trees: [{ trees: [], label: 30n }],
          label: 20n,
        },
      ],
      label: 1n,
    };

    const w = new CxsWriter();
    forestCodec.encode(w, forest);
    const decoded = forestCodec.decode(new CxsReader(w.finish()));
    expect(decoded).toEqual(forest);
  });

  it("round-trips an empty Forest", () => {
    const codecs = buildNamedCodecs(typeDefs);
    const forestCodec = codecs["Forest"];

    const empty = { trees: [], label: 0n };

    const w = new CxsWriter();
    forestCodec.encode(w, empty);
    const decoded = forestCodec.decode(new CxsReader(w.finish()));
    expect(decoded).toEqual(empty);
  });
});
