// Generated from default_wallet.spec.xdr - DefaultWallet interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@groundhogchain/protocol";
import * as __gh_protocol_utils from "@groundhogchain/protocol/utils";
import * as __gh_contract_spec from "@groundhogchain/contract-spec";
import * as __gh_client_contract from "../contract/index.js";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  DefaultWallet: {
    v0_1: {
      deploy: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("6be0cb0f6de0917a"),
      ),
      execute: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("c3edb11fdd6d5d58"),
      ),
    },
  },
} as const;

export namespace default_wallet {
  export namespace v0_1 {
    export namespace $interface {
      export interface WalletCall {
        target: __gh_protocol.ContractAddress;
        entrypoint: __gh_client_contract.FixedBytes<8>;
        gas_limit: bigint;
        calldata: globalThis.Uint8Array;
      }

      export type WalletError = 1n | 2n | 3n | 4n | 5n | 6n | 7n;

      export interface WalletInitCall {
        entrypoint: __gh_client_contract.FixedBytes<8>;
        gas_limit: bigint;
        calldata: globalThis.Uint8Array;
      }
    }
  }
}

export namespace DefaultWallet {
  export namespace v0_1 {
    export interface DeployArgs {
      nonce: __gh_client_contract.FixedBytes<32>;
      contractHash: __gh_client_contract.FixedBytes<32>;
      amount: bigint;
      initializer: __gh_codegen.default_wallet$v0_1$$interface$WalletInitCall | null;
    }
    export type DeployResult = __gh_protocol.ContractAddress;

    export interface ExecuteArgs {
      calls: __gh_codegen.default_wallet$v0_1$$interface$WalletCall[];
    }
    export type ExecuteResult = globalThis.Uint8Array[];

    export type DeclaredException = {
      kind: "declared";
      name: "WalletError";
      selector: 0x931d3297d37d1bdfn;
      value: __gh_codegen.default_wallet$v0_1$$interface$WalletError;
    };
    export type Exception =
      __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("DefaultWallet"),
      vers: __gh_s("0.1.0"),
      throws: [
        {
          selector: 0x931d3297d37d1bdfn,
          ty: {
            v: __gh_contract_spec.ContractTypeKind.Named,
            named: {
              crate_name: __gh_s("default_wallet"),
              major: __gh_s("0.1"),
              module_path: __gh_s("default_wallet::interface"),
              declared: __gh_s("WalletError"),
            },
          },
        },
      ],
      methods: [
        {
          name: __gh_s("deploy"),
          args: [
            {
              name: __gh_s("nonce"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Array,
                array: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  len: 32n,
                },
              },
            },
            {
              name: __gh_s("contract_hash"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Array,
                array: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  len: 32n,
                },
              },
            },
            {
              name: __gh_s("amount"),
              ty: { v: __gh_contract_spec.ContractTypeKind.U128 },
            },
            {
              name: __gh_s("initializer"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Option,
                option_inner: {
                  v: __gh_contract_spec.ContractTypeKind.Named,
                  named: {
                    crate_name: __gh_s("default_wallet"),
                    major: __gh_s("0.1"),
                    module_path: __gh_s("default_wallet::interface"),
                    declared: __gh_s("WalletInitCall"),
                  },
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Address },
          effect: null,
        },
        {
          name: __gh_s("execute"),
          args: [
            {
              name: __gh_s("calls"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Vector,
                vector: {
                  element: {
                    v: __gh_contract_spec.ContractTypeKind.Named,
                    named: {
                      crate_name: __gh_s("default_wallet"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("default_wallet::interface"),
                      declared: __gh_s("WalletCall"),
                    },
                  },
                  max_len: 4294967295n,
                },
              },
            },
          ],
          return_type: {
            v: __gh_contract_spec.ContractTypeKind.Vector,
            vector: {
              element: {
                v: __gh_contract_spec.ContractTypeKind.Vector,
                vector: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  max_len: 4294967295n,
                },
              },
              max_len: 4294967295n,
            },
          },
          effect: null,
        },
      ],
    },
  ],
  type_defs: [
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("default_wallet"),
          major: __gh_s("0.1"),
          module_path: __gh_s("default_wallet::interface"),
          declared: __gh_s("WalletCall"),
        },
        fields: [
          {
            name: __gh_s("target"),
            ty: { v: __gh_contract_spec.ContractTypeKind.Address },
          },
          {
            name: __gh_s("entrypoint"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Array,
              array: {
                element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                len: 8n,
              },
            },
          },
          {
            name: __gh_s("gas_limit"),
            ty: { v: __gh_contract_spec.ContractTypeKind.U64 },
          },
          {
            name: __gh_s("calldata"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Vector,
              vector: {
                element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                max_len: 4294967295n,
              },
            },
          },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: {
          crate_name: __gh_s("default_wallet"),
          major: __gh_s("0.1"),
          module_path: __gh_s("default_wallet::interface"),
          declared: __gh_s("WalletError"),
        },
        variants: [
          { name: __gh_s("NotRootInvocation"), value: 1n },
          { name: __gh_s("InvalidAuthClaim"), value: 2n },
          { name: __gh_s("EmptyCallList"), value: 3n },
          { name: __gh_s("TooManyCalls"), value: 4n },
          { name: __gh_s("CallAborted"), value: 5n },
          { name: __gh_s("CallFaulted"), value: 6n },
          { name: __gh_s("ReturnDataTooLarge"), value: 7n },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("default_wallet"),
          major: __gh_s("0.1"),
          module_path: __gh_s("default_wallet::interface"),
          declared: __gh_s("WalletInitCall"),
        },
        fields: [
          {
            name: __gh_s("entrypoint"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Array,
              array: {
                element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                len: 8n,
              },
            },
          },
          {
            name: __gh_s("gas_limit"),
            ty: { v: __gh_contract_spec.ContractTypeKind.U64 },
          },
          {
            name: __gh_s("calldata"),
            ty: {
              v: __gh_contract_spec.ContractTypeKind.Vector,
              vector: {
                element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                max_len: 4294967295n,
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

export const DefaultWallet = {
  v0_1: {
    deploy: __gh_client_contract.defineContractMethod<
      DefaultWallet.v0_1.DeployArgs,
      DefaultWallet.v0_1.DeployResult,
      DefaultWallet.v0_1.DeclaredException
    >({
      interfaceName: "DefaultWallet",
      interfaceVersion: "0.1.0",
      abiName: "deploy",
      publicName: "deploy",
      entrypoint: __gh_entrypoints.DefaultWallet.v0_1.deploy,
      effect: spec.interfaces[0]!.methods[0]!.effect,
      args: [
        {
          abiName: "nonce",
          publicName: "nonce",
          type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
        },
        {
          abiName: "contract_hash",
          publicName: "contractHash",
          type: spec.interfaces[0]!.methods[0]!.args[1]!.ty,
        },
        {
          abiName: "amount",
          publicName: "amount",
          type: spec.interfaces[0]!.methods[0]!.args[2]!.ty,
        },
        {
          abiName: "initializer",
          publicName: "initializer",
          type: spec.interfaces[0]!.methods[0]!.args[3]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[0]!.return_type,
      throws: [
        {
          selector: 0x931d3297d37d1bdfn,
          name: "WalletError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    execute: __gh_client_contract.defineContractMethod<
      DefaultWallet.v0_1.ExecuteArgs,
      DefaultWallet.v0_1.ExecuteResult,
      DefaultWallet.v0_1.DeclaredException
    >({
      interfaceName: "DefaultWallet",
      interfaceVersion: "0.1.0",
      abiName: "execute",
      publicName: "execute",
      entrypoint: __gh_entrypoints.DefaultWallet.v0_1.execute,
      effect: spec.interfaces[0]!.methods[1]!.effect,
      args: [
        {
          abiName: "calls",
          publicName: "calls",
          type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[1]!.return_type,
      throws: [
        {
          selector: 0x931d3297d37d1bdfn,
          name: "WalletError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const default_wallet = {
  v0_1: {
    $interface: {
      WalletError: {
        NotRootInvocation: 1n,
        InvalidAuthClaim: 2n,
        EmptyCallList: 3n,
        TooManyCalls: 4n,
        CallAborted: 5n,
        CallFaulted: 6n,
        ReturnDataTooLarge: 7n,
      },
    },
  },
} as const;

// The types the namespaces above refer to, under names no declaration can capture.
export namespace __gh_codegen {
  export type default_wallet$v0_1$$interface$WalletCall =
    default_wallet.v0_1.$interface.WalletCall;
  export type default_wallet$v0_1$$interface$WalletError =
    default_wallet.v0_1.$interface.WalletError;
  export type default_wallet$v0_1$$interface$WalletInitCall =
    default_wallet.v0_1.$interface.WalletInitCall;
}
