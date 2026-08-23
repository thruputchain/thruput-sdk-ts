// Generated from default_wallet.spec.xdr - DefaultWallet interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import type { ContractAddress } from "@groundhogchain/protocol";
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
  type FixedBytes,
} from "../contract/index.js";

const s = contractSpecString;

const entrypoints = {
  DefaultWallet: {
    deploy: contractEntrypointID(fromHex("6be0cb0f6de0917a")),
    execute: contractEntrypointID(fromHex("c3edb11fdd6d5d58")),
  },
} as const;

export interface WalletCall {
  target: ContractAddress;
  entrypoint: FixedBytes<8>;
  gas_limit: bigint;
  calldata: Uint8Array;
}

export const WalletError = {
  NotRootInvocation: 1n,
  InvalidAuthClaim: 2n,
  EmptyCallList: 3n,
  TooManyCalls: 4n,
  CallAborted: 5n,
  CallFaulted: 6n,
  ReturnDataTooLarge: 7n,
} as const;

export type WalletError = (typeof WalletError)[keyof typeof WalletError];

export interface DefaultWalletDeployArgs {
  nonce: FixedBytes<32>;
  contractHash: FixedBytes<32>;
}
export type DefaultWalletDeployResult = ContractAddress;

export interface DefaultWalletExecuteArgs {
  calls: WalletCall[];
}
export type DefaultWalletExecuteResult = Uint8Array[];

export type DefaultWalletDeclaredException = {
  kind: "declared";
  name: "WalletError";
  selector: 0x931d3297d37d1bdfn;
  value: WalletError;
};
export type DefaultWalletException =
  ContractException<DefaultWalletDeclaredException>;

export const spec: ContractSpec = {
  interfaces: [
    {
      name: s("DefaultWallet"),
      vers: s("0.1.0"),
      throws: [
        {
          selector: 0x931d3297d37d1bdfn,
          ty: { v: ContractTypeKind.Named, named: s("WalletError") },
        },
      ],
      methods: [
        {
          name: s("deploy"),
          args: [
            {
              name: s("nonce"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 32n },
              },
            },
            {
              name: s("contract_hash"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 32n },
              },
            },
          ],
          return_type: { v: ContractTypeKind.Address },
        },
        {
          name: s("execute"),
          args: [
            {
              name: s("calls"),
              ty: {
                v: ContractTypeKind.Vector,
                vector: {
                  element: {
                    v: ContractTypeKind.Named,
                    named: s("WalletCall"),
                  },
                  max_len: 4294967295n,
                },
              },
            },
          ],
          return_type: {
            v: ContractTypeKind.Vector,
            vector: {
              element: {
                v: ContractTypeKind.Vector,
                vector: {
                  element: { v: ContractTypeKind.U8 },
                  max_len: 4294967295n,
                },
              },
              max_len: 4294967295n,
            },
          },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: s("WalletCall"),
        fields: [
          { name: s("target"), ty: { v: ContractTypeKind.Address } },
          {
            name: s("entrypoint"),
            ty: {
              v: ContractTypeKind.Array,
              array: { element: { v: ContractTypeKind.U8 }, len: 8n },
            },
          },
          { name: s("gas_limit"), ty: { v: ContractTypeKind.U64 } },
          {
            name: s("calldata"),
            ty: {
              v: ContractTypeKind.Vector,
              vector: {
                element: { v: ContractTypeKind.U8 },
                max_len: 4294967295n,
              },
            },
          },
        ],
      },
    },
    {
      v: ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: s("WalletError"),
        variants: [
          { name: s("NotRootInvocation"), value: 1n },
          { name: s("InvalidAuthClaim"), value: 2n },
          { name: s("EmptyCallList"), value: 3n },
          { name: s("TooManyCalls"), value: 4n },
          { name: s("CallAborted"), value: 5n },
          { name: s("CallFaulted"), value: 6n },
          { name: s("ReturnDataTooLarge"), value: 7n },
        ],
      },
    },
  ],
  events: [],
};

const codecs = createContractCodecContext(spec.type_defs);

export const DefaultWallet = {
  deploy: defineContractMethod<
    DefaultWalletDeployArgs,
    DefaultWalletDeployResult,
    DefaultWalletDeclaredException
  >({
    entrypoint: entrypoints.DefaultWallet.deploy,
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
    ],
    returnType: spec.interfaces[0]!.methods[0]!.return_type,
    throws: [
      {
        selector: 0x931d3297d37d1bdfn,
        name: "WalletError",
        type: spec.interfaces[0]!.throws[0]!.ty,
      },
    ],
    codecs,
  }),
  execute: defineContractMethod<
    DefaultWalletExecuteArgs,
    DefaultWalletExecuteResult,
    DefaultWalletDeclaredException
  >({
    entrypoint: entrypoints.DefaultWallet.execute,
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
    codecs,
  }),
} as const;
