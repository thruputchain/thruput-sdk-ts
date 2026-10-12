// Generated from signed_op.spec.xdr - SignedOp interface v0.1.41
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@thruputchain/protocol";
import * as __gh_protocol_utils from "@thruputchain/protocol/utils";
import * as __gh_contract_spec from "@thruputchain/contract-spec";
import * as __gh_client_contract from "../contract/index.js";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  SignedOp: {
    v0_1: {
      executeSignedOp: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("c281dc2ffb5eeb1e"),
      ),
    },
  },
} as const;

export namespace groundhog_signed_op_if {
  export namespace v0_1 {
    export interface Operation {
      block_expiry_height: bigint;
      nonce: bigint;
      body: globalThis.Uint8Array;
    }

    export namespace error {
      export type SignedOpError = 1n | 2n | 3n | 4n | 5n;
    }
  }
}

export namespace SignedOp {
  export namespace v0_1 {
    export interface ExecuteSignedOpArgs {
      op: __gh_codegen.groundhog_signed_op_if$v0_1$Operation;
      signature: __gh_client_contract.FixedBytes<64>;
    }
    export type ExecuteSignedOpResult = __gh_client_contract.SignedToken;

    export type DeclaredException = {
      kind: "declared";
      name: "SignedOpError";
      selector: 0x65f3de61c8178163n;
      value: __gh_codegen.groundhog_signed_op_if$v0_1$error$SignedOpError;
    };
    export type Exception =
      __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("SignedOp"),
      vers: __gh_s("0.1.41"),
      throws: [
        {
          selector: 0x65f3de61c8178163n,
          ty: {
            v: __gh_contract_spec.ContractTypeKind.Named,
            named: {
              crate_name: __gh_s("groundhog-signed-op-if"),
              major: __gh_s("0.1"),
              module_path: __gh_s("groundhog_signed_op_if::error"),
              declared: __gh_s("SignedOpError"),
            },
          },
        },
      ],
      methods: [
        {
          name: __gh_s("execute_signed_op"),
          args: [
            {
              name: __gh_s("op"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Named,
                named: {
                  crate_name: __gh_s("groundhog-signed-op-if"),
                  major: __gh_s("0.1"),
                  module_path: __gh_s("groundhog_signed_op_if"),
                  declared: __gh_s("Operation"),
                },
              },
            },
            {
              name: __gh_s("signature"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.Array,
                array: {
                  element: { v: __gh_contract_spec.ContractTypeKind.U8 },
                  len: 64n,
                },
              },
            },
          ],
          return_type: {
            v: __gh_contract_spec.ContractTypeKind.SignedToken,
            signed_token_preimage: { preimage_type: null },
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
          crate_name: __gh_s("groundhog-signed-op-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("groundhog_signed_op_if"),
          declared: __gh_s("Operation"),
        },
        fields: [
          {
            name: __gh_s("block_expiry_height"),
            ty: { v: __gh_contract_spec.ContractTypeKind.I64 },
          },
          {
            name: __gh_s("nonce"),
            ty: { v: __gh_contract_spec.ContractTypeKind.U64 },
          },
          {
            name: __gh_s("body"),
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
          crate_name: __gh_s("groundhog-signed-op-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("groundhog_signed_op_if::error"),
          declared: __gh_s("SignedOpError"),
        },
        variants: [
          { name: __gh_s("InvalidSignature"), value: 1n },
          { name: __gh_s("Expired"), value: 2n },
          { name: __gh_s("AlreadyConsumed"), value: 3n },
          { name: __gh_s("MalformedBody"), value: 4n },
          { name: __gh_s("NotYetExpired"), value: 5n },
        ],
      },
    },
  ],
  events: [],
};

const __gh_codecs = __gh_client_contract.createContractCodecContext(
  spec.type_defs,
);

export const SignedOp = {
  v0_1: {
    executeSignedOp: __gh_client_contract.defineContractMethod<
      SignedOp.v0_1.ExecuteSignedOpArgs,
      SignedOp.v0_1.ExecuteSignedOpResult,
      SignedOp.v0_1.DeclaredException
    >({
      interfaceName: "SignedOp",
      interfaceVersion: "0.1.41",
      abiName: "execute_signed_op",
      publicName: "executeSignedOp",
      entrypoint: __gh_entrypoints.SignedOp.v0_1.executeSignedOp,
      effect: spec.interfaces[0]!.methods[0]!.effect,
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
      codecs: __gh_codecs,
    }),
  },
} as const;

export const groundhog_signed_op_if = {
  v0_1: {
    error: {
      SignedOpError: {
        InvalidSignature: 1n,
        Expired: 2n,
        AlreadyConsumed: 3n,
        MalformedBody: 4n,
        NotYetExpired: 5n,
      },
    },
  },
} as const;

// The types the namespaces above refer to, under names no declaration can capture.
export namespace __gh_codegen {
  export type groundhog_signed_op_if$v0_1$Operation =
    groundhog_signed_op_if.v0_1.Operation;
  export type groundhog_signed_op_if$v0_1$error$SignedOpError =
    groundhog_signed_op_if.v0_1.error.SignedOpError;
}
