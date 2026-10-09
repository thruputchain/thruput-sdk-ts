// Generated from dev_wallet.spec.xdr - DevWallet interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@groundhogchain/protocol";
import * as __gh_protocol_utils from "@groundhogchain/protocol/utils";
import * as __gh_contract_spec from "@groundhogchain/contract-spec";
import * as __gh_client_contract from "../contract/index.js";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  DevWallet: {
    v0_1: {
      createWallet: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("78b187d37f222827"),
      ),
      deploy: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("f969542572bd6860"),
      ),
      doAction: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("a0fff94c64fbaf3c"),
      ),
      initialize: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("77b7af6606c91791"),
      ),
    },
  },
} as const;

export namespace DevWallet {
  export namespace v0_1 {
    export interface CreateWalletArgs {
      nonce: __gh_client_contract.FixedBytes<32>;
      walletContractHash: __gh_client_contract.FixedBytes<32>;
      owner: __gh_client_contract.FixedBytes<32>;
    }
    export type CreateWalletResult = __gh_protocol.ContractAddress;

    export interface DeployArgs {
      nonce: __gh_client_contract.FixedBytes<32>;
      contractHash: __gh_client_contract.FixedBytes<32>;
    }
    export type DeployResult = __gh_protocol.ContractAddress;

    export interface DoActionArgs {
      invocationBytes: globalThis.Uint8Array;
    }
    export type DoActionResult = void;

    export interface InitializeArgs {
      owner: __gh_client_contract.FixedBytes<32>;
    }
    export type InitializeResult = void;

    export type DeclaredException = never;
    export type Exception =
      __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("DevWallet"),
      vers: __gh_s("0.1.0"),
      throws: [],
      methods: [
        {
          name: __gh_s("create_wallet"),
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
              name: __gh_s("wallet_contract_hash"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Array,
                array: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  len: 32n,
                },
              },
            },
            {
              name: __gh_s("owner"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Array,
                array: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  len: 32n,
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Address },
          effect: null,
        },
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
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Address },
          effect: null,
        },
        {
          name: __gh_s("do_action"),
          args: [
            {
              name: __gh_s("invocation_bytes"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Vector,
                vector: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  max_len: 4294967295n,
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("initialize"),
          args: [
            {
              name: __gh_s("owner"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Array,
                array: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  len: 32n,
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
      ],
    },
  ],
  type_defs: [],
  events: [],
};

const __gh_codecs = __gh_client_contract.createContractCodecContext(
  spec.type_defs,
);

export const DevWallet = {
  v0_1: {
    createWallet: __gh_client_contract.defineContractMethod<
      DevWallet.v0_1.CreateWalletArgs,
      DevWallet.v0_1.CreateWalletResult,
      DevWallet.v0_1.DeclaredException
    >({
      interfaceName: "DevWallet",
      interfaceVersion: "0.1.0",
      abiName: "create_wallet",
      publicName: "createWallet",
      entrypoint: __gh_entrypoints.DevWallet.v0_1.createWallet,
      effect: spec.interfaces[0]!.methods[0]!.effect,
      args: [
        {
          abiName: "nonce",
          publicName: "nonce",
          type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
        },
        {
          abiName: "wallet_contract_hash",
          publicName: "walletContractHash",
          type: spec.interfaces[0]!.methods[0]!.args[1]!.ty,
        },
        {
          abiName: "owner",
          publicName: "owner",
          type: spec.interfaces[0]!.methods[0]!.args[2]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[0]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
    deploy: __gh_client_contract.defineContractMethod<
      DevWallet.v0_1.DeployArgs,
      DevWallet.v0_1.DeployResult,
      DevWallet.v0_1.DeclaredException
    >({
      interfaceName: "DevWallet",
      interfaceVersion: "0.1.0",
      abiName: "deploy",
      publicName: "deploy",
      entrypoint: __gh_entrypoints.DevWallet.v0_1.deploy,
      effect: spec.interfaces[0]!.methods[1]!.effect,
      args: [
        {
          abiName: "nonce",
          publicName: "nonce",
          type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
        },
        {
          abiName: "contract_hash",
          publicName: "contractHash",
          type: spec.interfaces[0]!.methods[1]!.args[1]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[1]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
    doAction: __gh_client_contract.defineContractMethod<
      DevWallet.v0_1.DoActionArgs,
      DevWallet.v0_1.DoActionResult,
      DevWallet.v0_1.DeclaredException
    >({
      interfaceName: "DevWallet",
      interfaceVersion: "0.1.0",
      abiName: "do_action",
      publicName: "doAction",
      entrypoint: __gh_entrypoints.DevWallet.v0_1.doAction,
      effect: spec.interfaces[0]!.methods[2]!.effect,
      args: [
        {
          abiName: "invocation_bytes",
          publicName: "invocationBytes",
          type: spec.interfaces[0]!.methods[2]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[2]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
    initialize: __gh_client_contract.defineContractMethod<
      DevWallet.v0_1.InitializeArgs,
      DevWallet.v0_1.InitializeResult,
      DevWallet.v0_1.DeclaredException
    >({
      interfaceName: "DevWallet",
      interfaceVersion: "0.1.0",
      abiName: "initialize",
      publicName: "initialize",
      entrypoint: __gh_entrypoints.DevWallet.v0_1.initialize,
      effect: spec.interfaces[0]!.methods[3]!.effect,
      args: [
        {
          abiName: "owner",
          publicName: "owner",
          type: spec.interfaces[0]!.methods[3]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[3]!.return_type,
      throws: [],
      codecs: __gh_codecs,
    }),
  },
} as const;
