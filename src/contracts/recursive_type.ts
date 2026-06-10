// Generated from recursive_type.wasm — RecursiveTypeContract interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import type {
  ContractAddress,
  GasAmount,
  Invocation,
} from "@groundhogchain/protocol";
import { contractEntrypointID } from "@groundhogchain/protocol";
import { fromHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeKind,
  ContractTypeDefKind,
  contractSpecString,
} from "@groundhogchain/contract-spec";
import type { ContractSpec } from "../contract/spec.js";
import { encodeCalldata } from "../contract/encode.js";
import { buildNamedCodecs } from "../contract/codegen.js";
import { createInvocation } from "../transaction/build.js";

const s = contractSpecString;

const entrypoints = {
  depth: contractEntrypointID(fromHex("106679439ef5dc4a")),
  forest_depth: contractEntrypointID(fromHex("c43faa39b39b4097")),
  unbox: contractEntrypointID(fromHex("38343b330809190f")),
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

const namedCodecs = buildNamedCodecs(spec.type_defs);

export function depth(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { tree: Tree },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.depth,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "RecursiveTypeContract",
      "depth",
      [args.tree],
      namedCodecs,
    ),
  });
}

export function forest_depth(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { forest: Forest },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.forest_depth,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "RecursiveTypeContract",
      "forest_depth",
      [args.forest],
      namedCodecs,
    ),
  });
}

export function unbox(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { val: bigint },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.unbox,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "RecursiveTypeContract",
      "unbox",
      [args.val],
      namedCodecs,
    ),
  });
}
