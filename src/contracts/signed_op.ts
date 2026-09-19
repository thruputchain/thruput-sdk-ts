// Generated from signed_op.spec.xdr - SignedOp interface v0.1.22
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
  type FixedBytes,
  type SignedToken,
} from "../contract/index.js";

const s = contractSpecString;

const entrypoints = {
  SignedOp: {
    executeSignedOp: contractEntrypointID(fromHex("c281dc2ffb5eeb1e")),
  },
} as const;

export interface Operation {
  block_expiry_height: bigint;
  nonce: bigint;
  body: Uint8Array;
}

export const SignedOpError = {
  InvalidSignature: 1n,
  Expired: 2n,
  AlreadyConsumed: 3n,
  MalformedBody: 4n,
  NotYetExpired: 5n,
} as const;

export type SignedOpError = (typeof SignedOpError)[keyof typeof SignedOpError];

export interface SignedOpExecuteSignedOpArgs {
  op: Operation;
  signature: FixedBytes<64>;
}
export type SignedOpExecuteSignedOpResult = SignedToken;

export type SignedOpDeclaredException = {
  kind: "declared";
  name: "SignedOpError";
  selector: 0x65f3de61c8178163n;
  value: SignedOpError;
};
export type SignedOpException = ContractException<SignedOpDeclaredException>;

export const spec: ContractSpec = {
  interfaces: [
    {
      name: s("SignedOp"),
      vers: s("0.1.22"),
      throws: [
        {
          selector: 0x65f3de61c8178163n,
          ty: { v: ContractTypeKind.Named, named: s("SignedOpError") },
        },
      ],
      methods: [
        {
          name: s("execute_signed_op"),
          args: [
            {
              name: s("op"),
              ty: { v: ContractTypeKind.Named, named: s("Operation") },
            },
            {
              name: s("signature"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 64n },
              },
            },
          ],
          return_type: {
            v: ContractTypeKind.SignedToken,
            signed_token_preimage: { preimage_type: null },
          },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: s("Operation"),
        fields: [
          { name: s("block_expiry_height"), ty: { v: ContractTypeKind.I64 } },
          { name: s("nonce"), ty: { v: ContractTypeKind.U64 } },
          {
            name: s("body"),
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
        name: s("SignedOpError"),
        variants: [
          { name: s("InvalidSignature"), value: 1n },
          { name: s("Expired"), value: 2n },
          { name: s("AlreadyConsumed"), value: 3n },
          { name: s("MalformedBody"), value: 4n },
          { name: s("NotYetExpired"), value: 5n },
        ],
      },
    },
  ],
  events: [],
};

const codecs = createContractCodecContext(spec.type_defs);

export const SignedOp = {
  executeSignedOp: defineContractMethod<
    SignedOpExecuteSignedOpArgs,
    SignedOpExecuteSignedOpResult,
    SignedOpDeclaredException
  >({
    interfaceName: "SignedOp",
    interfaceVersion: "0.1.22",
    abiName: "execute_signed_op",
    publicName: "executeSignedOp",
    entrypoint: entrypoints.SignedOp.executeSignedOp,
    args: [
      {
        abiName: "op",
        publicName: "op",
        type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
      },
      {
        abiName: "signature",
        publicName: "signature",
        type: spec.interfaces[0]!.methods[0]!.args[1]!.ty,
      },
    ],
    returnType: spec.interfaces[0]!.methods[0]!.return_type,
    throws: [
      {
        selector: 0x65f3de61c8178163n,
        name: "SignedOpError",
        type: spec.interfaces[0]!.throws[0]!.ty,
      },
    ],
    codecs,
  }),
} as const;
