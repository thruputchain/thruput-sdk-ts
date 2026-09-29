// Generated from recursive_type.spec.xdr - RecursiveTypeContract interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@groundhogchain/protocol";
import * as __gh_protocol_utils from "@groundhogchain/protocol/utils";
import * as __gh_contract_spec from "@groundhogchain/contract-spec";
import * as __gh_client_contract from "../contract/index.js";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  RecursiveTypeContract: {
    v0_1: {
      depth: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("1abed5310419683c"),
      ),
      forestDepth: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("a1ba4c1c500f0487"),
      ),
      unbox: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("daa333c1ea91396a"),
      ),
    },
  },
} as const;

export namespace recursive_type {
  export namespace v0_4 {
    export namespace implementation {
      export interface Forest {
        trees: __gh_codegen.recursive_type$v0_4$implementation$Forest[];
        label: bigint;
      }

      export interface Tree {
        value: bigint;
        left: __gh_codegen.recursive_type$v0_4$implementation$Tree | null;
        right: __gh_codegen.recursive_type$v0_4$implementation$Tree | null;
      }
    }
  }
}

export namespace RecursiveTypeContract {
  export namespace v0_1 {
    export interface DepthArgs {
      tree: __gh_codegen.recursive_type$v0_4$implementation$Tree;
    }
    export type DepthResult = bigint;

    export interface ForestDepthArgs {
      forest: __gh_codegen.recursive_type$v0_4$implementation$Forest;
    }
    export type ForestDepthResult = bigint;

    export interface UnboxArgs {
      val: bigint;
    }
    export type UnboxResult = bigint;

    export type DeclaredException = never;
    export type Exception =
      __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("RecursiveTypeContract"),
      vers: __gh_s("0.1.0"),
      throws: [],
      methods: [
        {
          name: __gh_s("depth"),
          args: [
            {
              name: __gh_s("tree"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Named,
                named: {
                  crate_name: __gh_s("recursive_type"),
                  major: __gh_s("0.4"),
                  module_path: __gh_s("recursive_type::implementation"),
                  declared: __gh_s("Tree"),
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.U32 },
        },
        {
          name: __gh_s("forest_depth"),
          args: [
            {
              name: __gh_s("forest"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Named,
                named: {
                  crate_name: __gh_s("recursive_type"),
                  major: __gh_s("0.4"),
                  module_path: __gh_s("recursive_type::implementation"),
                  declared: __gh_s("Forest"),
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.U32 },
        },
        {
          name: __gh_s("unbox"),
          args: [
            {
              name: __gh_s("val"),
              ty: { v: __gh_contract_spec.ContractTypeKind.U32 },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.U32 },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("recursive_type"),
          major: __gh_s("0.4"),
          module_path: __gh_s("recursive_type::implementation"),
          declared: __gh_s("Forest"),
        },
        fields: [
          {
            name: __gh_s("trees"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Vector,
              vector: {
                element: {
                  v: __gh_contract_spec.ContractTypeKind.Named,
                  named: {
                    crate_name: __gh_s("recursive_type"),
                    major: __gh_s("0.4"),
                    module_path: __gh_s("recursive_type::implementation"),
                    declared: __gh_s("Forest"),
                  },
                },
                max_len: 4294967295n,
              },
            },
          },
          {
            name: __gh_s("label"),
            ty: { v: __gh_contract_spec.ContractTypeKind.U32 },
          },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("recursive_type"),
          major: __gh_s("0.4"),
          module_path: __gh_s("recursive_type::implementation"),
          declared: __gh_s("Tree"),
        },
        fields: [
          {
            name: __gh_s("value"),
            ty: { v: __gh_contract_spec.ContractTypeKind.U32 },
          },
          {
            name: __gh_s("left"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Option,
              option_inner: {
                v: __gh_contract_spec.ContractTypeKind.Named,
                named: {
                  crate_name: __gh_s("recursive_type"),
                  major: __gh_s("0.4"),
                  module_path: __gh_s("recursive_type::implementation"),
                  declared: __gh_s("Tree"),
                },
              },
            },
          },
          {
            name: __gh_s("right"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Option,
              option_inner: {
                v: __gh_contract_spec.ContractTypeKind.Named,
                named: {
                  crate_name: __gh_s("recursive_type"),
                  major: __gh_s("0.4"),
                  module_path: __gh_s("recursive_type::implementation"),
                  declared: __gh_s("Tree"),
                },
              },
            },
          },
        ],
      },
    },
  ],
  events: [],
};

const __gh_codecs = __gh_client_contract.createContractCodecContext(
  spec.type_defs,
);

export const RecursiveTypeContract = {
  v0_1: {
    depth: __gh_client_contract.defineContractMethod<
      RecursiveTypeContract.v0_1.DepthArgs,
      RecursiveTypeContract.v0_1.DepthResult,
      RecursiveTypeContract.v0_1.DeclaredException
    >({
      interfaceName: "RecursiveTypeContract",
      interfaceVersion: "0.1.0",
      abiName: "depth",
      publicName: "depth",
      entrypoint: __gh_entrypoints.RecursiveTypeContract.v0_1.depth,
      args: [
        {
          abiName: "tree",
          publicName: "tree",
          type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[0]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
    forestDepth: __gh_client_contract.defineContractMethod<
      RecursiveTypeContract.v0_1.ForestDepthArgs,
      RecursiveTypeContract.v0_1.ForestDepthResult,
      RecursiveTypeContract.v0_1.DeclaredException
    >({
      interfaceName: "RecursiveTypeContract",
      interfaceVersion: "0.1.0",
      abiName: "forest_depth",
      publicName: "forestDepth",
      entrypoint: __gh_entrypoints.RecursiveTypeContract.v0_1.forestDepth,
      args: [
        {
          abiName: "forest",
          publicName: "forest",
          type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[1]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
    unbox: __gh_client_contract.defineContractMethod<
      RecursiveTypeContract.v0_1.UnboxArgs,
      RecursiveTypeContract.v0_1.UnboxResult,
      RecursiveTypeContract.v0_1.DeclaredException
    >({
      interfaceName: "RecursiveTypeContract",
      interfaceVersion: "0.1.0",
      abiName: "unbox",
      publicName: "unbox",
      entrypoint: __gh_entrypoints.RecursiveTypeContract.v0_1.unbox,
      args: [
        {
          abiName: "val",
          publicName: "val",
          type: spec.interfaces[0]!.methods[2]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[2]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
  },
} as const;

// The types the namespaces above refer to, under names no declaration can capture.
export namespace __gh_codegen {
  export type recursive_type$v0_4$implementation$Forest =
    recursive_type.v0_4.implementation.Forest;
  export type recursive_type$v0_4$implementation$Tree =
    recursive_type.v0_4.implementation.Tree;
}
