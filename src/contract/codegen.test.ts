import { assert, describe, expect, it } from "vitest";
import { CxsWriter, CxsReader } from "@groundhogchain/protocol";
import {
  contractSpecString,
  ContractTypeKind,
  ContractTypeDefKind,
  type ContractSpecId,
} from "@groundhogchain/contract-spec";
import type { ContractTypeDef } from "./spec.js";
import { buildNamedCodecs } from "./codegen.js";

const s = contractSpecString;

/** A spec id for a test type: one demo crate, so only the name varies. */
function specId(declared: string): ContractSpecId {
  return {
    crate_name: s("demo"),
    major: s("1"),
    module_path: s("demo"),
    declared: s(declared),
  };
}

describe("buildNamedCodecs with recursive types", () => {
  const typeDefs: ContractTypeDef[] = [
    {
      v: ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: specId("Forest"),
        fields: [
          {
            name: s("trees"),
            ty: {
              v: ContractTypeKind.Vector,
              vector: {
                element: { v: ContractTypeKind.Named, named: specId("Forest") },
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
        name: specId("Tree"),
        fields: [
          { name: s("value"), ty: { v: ContractTypeKind.U32 } },
          {
            name: s("left"),
            ty: {
              v: ContractTypeKind.Option,
              option_inner: { v: ContractTypeKind.Named, named: specId("Tree") },
            },
          },
          {
            name: s("right"),
            ty: {
              v: ContractTypeKind.Option,
              option_inner: { v: ContractTypeKind.Named, named: specId("Tree") },
            },
          },
        ],
      },
    },
  ];

  it("round-trips a Tree with nested children", () => {
    const codecs = buildNamedCodecs(typeDefs);
    const treeCodec = codecs["Tree"];
    assert.isDefined(treeCodec);

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
    assert.isDefined(treeCodec);

    const leaf = { value: 42n, left: null, right: null };

    const w = new CxsWriter();
    treeCodec.encode(w, leaf);
    const decoded = treeCodec.decode(new CxsReader(w.finish()));
    expect(decoded).toEqual(leaf);
  });

  it("round-trips a Forest with nested forests", () => {
    const codecs = buildNamedCodecs(typeDefs);
    const forestCodec = codecs["Forest"];
    assert.isDefined(forestCodec);

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
    assert.isDefined(forestCodec);

    const empty = { trees: [], label: 0n };

    const w = new CxsWriter();
    forestCodec.encode(w, empty);
    const decoded = forestCodec.decode(new CxsReader(w.finish()));
    expect(decoded).toEqual(empty);
  });
});
