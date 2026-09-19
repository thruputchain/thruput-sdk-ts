// Generated from recursive_type.spec.xdr - RecursiveTypeContract interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import { contractEntrypointID } from "@groundhogchain/protocol";
import { fromHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeKind,
  ContractTypeDefKind,
  contractSpecString,
} from "@groundhogchain/contract-spec";
import {
  type ContractSpec,
  createContractCodecContext,
  defineContractMethod,
  type ContractException,
} from "../contract/index.js";

const s = contractSpecString;

const entrypoints = {
  RecursiveTypeContract: {
    depth: contractEntrypointID(fromHex("1abed5310419683c")),
    forestDepth: contractEntrypointID(fromHex("a1ba4c1c500f0487")),
    unbox: contractEntrypointID(fromHex("daa333c1ea91396a")),
  },
} as const;

export interface Forest {
  trees: Forest[];
  label: bigint;
}

export interface Tree {
  value: bigint;
  left: Tree | null;
  right: Tree | null;
}

export interface RecursiveTypeContractDepthArgs {
  tree: Tree;
}
export type RecursiveTypeContractDepthResult = bigint;

export interface RecursiveTypeContractForestDepthArgs {
  forest: Forest;
}
export type RecursiveTypeContractForestDepthResult = bigint;

export interface RecursiveTypeContractUnboxArgs {
  val: bigint;
}
export type RecursiveTypeContractUnboxResult = bigint;

export type RecursiveTypeContractDeclaredException = never;
export type RecursiveTypeContractException =
  ContractException<RecursiveTypeContractDeclaredException>;

export const spec: ContractSpec = {
  interfaces: [
    {
      name: s("RecursiveTypeContract"),
      vers: s("0.1.0"),
      throws: [],
      methods: [
        {
          name: s("depth"),
          args: [
            {
              name: s("tree"),
              ty: { v: ContractTypeKind.Named, named: s("Tree") },
            },
          ],
          return_type: { v: ContractTypeKind.U32 },
        },
        {
          name: s("forest_depth"),
          args: [
            {
              name: s("forest"),
              ty: { v: ContractTypeKind.Named, named: s("Forest") },
            },
          ],
          return_type: { v: ContractTypeKind.U32 },
        },
        {
          name: s("unbox"),
          args: [{ name: s("val"), ty: { v: ContractTypeKind.U32 } }],
          return_type: { v: ContractTypeKind.U32 },
        },
      ],
    },
  ],
  type_defs: [
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
  ],
  events: [],
};

const codecs = createContractCodecContext(spec.type_defs);

export const RecursiveTypeContract = {
  depth: defineContractMethod<
    RecursiveTypeContractDepthArgs,
    RecursiveTypeContractDepthResult,
    RecursiveTypeContractDeclaredException
  >({
    interfaceName: "RecursiveTypeContract",
    interfaceVersion: "0.1.0",
    abiName: "depth",
    publicName: "depth",
    entrypoint: entrypoints.RecursiveTypeContract.depth,
    args: [
      {
        abiName: "tree",
        publicName: "tree",
        type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
      },
    ],
    returnType: spec.interfaces[0]!.methods[0]!.return_type,
    throws: [],
    codecs,
  }),
  forestDepth: defineContractMethod<
    RecursiveTypeContractForestDepthArgs,
    RecursiveTypeContractForestDepthResult,
    RecursiveTypeContractDeclaredException
  >({
    interfaceName: "RecursiveTypeContract",
    interfaceVersion: "0.1.0",
    abiName: "forest_depth",
    publicName: "forestDepth",
    entrypoint: entrypoints.RecursiveTypeContract.forestDepth,
    args: [
      {
        abiName: "forest",
        publicName: "forest",
        type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
      },
    ],
    returnType: spec.interfaces[0]!.methods[1]!.return_type,
    throws: [],
    codecs,
  }),
  unbox: defineContractMethod<
    RecursiveTypeContractUnboxArgs,
    RecursiveTypeContractUnboxResult,
    RecursiveTypeContractDeclaredException
  >({
    interfaceName: "RecursiveTypeContract",
    interfaceVersion: "0.1.0",
    abiName: "unbox",
    publicName: "unbox",
    entrypoint: entrypoints.RecursiveTypeContract.unbox,
    args: [
      {
        abiName: "val",
        publicName: "val",
        type: spec.interfaces[0]!.methods[2]!.args[0]!.ty,
      },
    ],
    returnType: spec.interfaces[0]!.methods[2]!.return_type,
    throws: [],
    codecs,
  }),
} as const;
