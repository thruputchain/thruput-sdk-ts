// Generated from erc20_permit.spec.xdr - ERC20Permit interface v0.1.41
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@groundhogchain/protocol";
import * as __gh_protocol_utils from "@groundhogchain/protocol/utils";
import * as __gh_contract_spec from "@groundhogchain/contract-spec";
import * as __gh_client_contract from "../contract/index.js";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  ERC20Permit: {
    v0_1: {
      clearAllowanceSigned: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("30ee8dbff2e8e181"),
      ),
      increaseAllowanceSigned: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("3a47108e9850272e"),
      ),
      transferFromSigned: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("87c3df36183d4aec"),
      ),
    },
  },
} as const;

export namespace groundhog_erc20_if {
  export namespace v0_1 {
    export namespace error {
      export type ERC20Error = 1n | 2n | 3n | 4n | 100n;
    }
  }
}

export namespace groundhog_erc20_permit_if {
  export namespace v0_1 {
    export interface ClearAllowanceGrant {
      spender: __gh_protocol.ContractAddress;
    }

    export interface PermitGrant {
      spender: __gh_protocol.ContractAddress;
      amount: bigint;
    }

    export namespace error {
      export type ERC20PermitError = 1n | 2n;
    }
  }
}

export namespace ERC20Permit {
  export namespace v0_1 {
    export interface ClearAllowanceSignedArgs {
      grant: __gh_client_contract.SignedToken<__gh_codegen.groundhog_erc20_permit_if$v0_1$ClearAllowanceGrant>;
    }
    export type ClearAllowanceSignedResult = void;

    export interface IncreaseAllowanceSignedArgs {
      grant: __gh_client_contract.SignedToken<__gh_codegen.groundhog_erc20_permit_if$v0_1$PermitGrant>;
    }
    export type IncreaseAllowanceSignedResult = void;

    export interface TransferFromSignedArgs {
      grant: __gh_client_contract.SignedToken<__gh_codegen.groundhog_erc20_permit_if$v0_1$PermitGrant>;
      receiver: __gh_protocol.ContractAddress;
      amount: bigint;
    }
    export type TransferFromSignedResult = void;

    export type DeclaredException =
      | {
          kind: "declared";
          name: "ERC20Error";
          selector: 0xb19947acb2fa14ffn;
          value: __gh_codegen.groundhog_erc20_if$v0_1$error$ERC20Error;
        }
      | {
          kind: "declared";
          name: "ERC20PermitError";
          selector: 0xe8abb072f5171148n;
          value: __gh_codegen.groundhog_erc20_permit_if$v0_1$error$ERC20PermitError;
        };
    export type Exception =
      __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("ERC20Permit"),
      vers: __gh_s("0.1.41"),
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          ty: {
            v: __gh_contract_spec.ContractTypeKind.Named,
            named: {
              crate_name: __gh_s("groundhog-erc20-if"),
              major: __gh_s("0.1"),
              module_path: __gh_s("groundhog_erc20_if::error"),
              declared: __gh_s("ERC20Error"),
            },
          },
        },
        {
          selector: 0xe8abb072f5171148n,
          ty: {
            v: __gh_contract_spec.ContractTypeKind.Named,
            named: {
              crate_name: __gh_s("groundhog-erc20-permit-if"),
              major: __gh_s("0.1"),
              module_path: __gh_s("groundhog_erc20_permit_if::error"),
              declared: __gh_s("ERC20PermitError"),
            },
          },
        },
      ],
      methods: [
        {
          name: __gh_s("clear_allowance_signed"),
          args: [
            {
              name: __gh_s("grant"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.SignedToken,
                signed_token_preimage: {
                  preimage_type: {
                    v: __gh_contract_spec.ContractTypeKind.Named,
                    named: {
                      crate_name: __gh_s("groundhog-erc20-permit-if"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("groundhog_erc20_permit_if"),
                      declared: __gh_s("ClearAllowanceGrant"),
                    },
                  },
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("increase_allowance_signed"),
          args: [
            {
              name: __gh_s("grant"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.SignedToken,
                signed_token_preimage: {
                  preimage_type: {
                    v: __gh_contract_spec.ContractTypeKind.Named,
                    named: {
                      crate_name: __gh_s("groundhog-erc20-permit-if"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("groundhog_erc20_permit_if"),
                      declared: __gh_s("PermitGrant"),
                    },
                  },
                },
              },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
        {
          name: __gh_s("transfer_from_signed"),
          args: [
            {
              name: __gh_s("grant"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.SignedToken,
                signed_token_preimage: {
                  preimage_type: {
                    v: __gh_contract_spec.ContractTypeKind.Named,
                    named: {
                      crate_name: __gh_s("groundhog-erc20-permit-if"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("groundhog_erc20_permit_if"),
                      declared: __gh_s("PermitGrant"),
                    },
                  },
                },
              },
            },
            {
              name: __gh_s("receiver"),
              ty: { v: __gh_contract_spec.ContractTypeKind.Address },
            },
            {
              name: __gh_s("amount"),
              ty: { v: __gh_contract_spec.ContractTypeKind.U128 },
            },
          ],
          return_type: { v: __gh_contract_spec.ContractTypeKind.Void },
          effect: null,
        },
      ],
    },
  ],
  type_defs: [
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: {
          crate_name: __gh_s("groundhog-erc20-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("groundhog_erc20_if::error"),
          declared: __gh_s("ERC20Error"),
        },
        variants: [
          { name: __gh_s("AlreadyInitialized"), value: 1n },
          { name: __gh_s("MustBeContractOwner"), value: 2n },
          { name: __gh_s("TooLarge"), value: 3n },
          { name: __gh_s("BalanceNotZero"), value: 4n },
          { name: __gh_s("Internal"), value: 100n },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("groundhog-erc20-permit-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("groundhog_erc20_permit_if"),
          declared: __gh_s("ClearAllowanceGrant"),
        },
        fields: [
          {
            name: __gh_s("spender"),
            ty: { v: __gh_contract_spec.ContractTypeKind.Address },
          },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("groundhog-erc20-permit-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("groundhog_erc20_permit_if"),
          declared: __gh_s("PermitGrant"),
        },
        fields: [
          {
            name: __gh_s("spender"),
            ty: { v: __gh_contract_spec.ContractTypeKind.Address },
          },
          {
            name: __gh_s("amount"),
            ty: { v: __gh_contract_spec.ContractTypeKind.U128 },
          },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: {
          crate_name: __gh_s("groundhog-erc20-permit-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("groundhog_erc20_permit_if::error"),
          declared: __gh_s("ERC20PermitError"),
        },
        variants: [
          { name: __gh_s("NotSpender"), value: 1n },
          { name: __gh_s("ExceedsGrant"), value: 2n },
        ],
      },
    },
  ],
  events: [],
};

const __gh_codecs = __gh_client_contract.createContractCodecContext(
  spec.type_defs,
);

export const ERC20Permit = {
  v0_1: {
    clearAllowanceSigned: __gh_client_contract.defineContractMethod<
      ERC20Permit.v0_1.ClearAllowanceSignedArgs,
      ERC20Permit.v0_1.ClearAllowanceSignedResult,
      ERC20Permit.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Permit",
      interfaceVersion: "0.1.41",
      abiName: "clear_allowance_signed",
      publicName: "clearAllowanceSigned",
      entrypoint: __gh_entrypoints.ERC20Permit.v0_1.clearAllowanceSigned,
      effect: spec.interfaces[0]!.methods[0]!.effect,
      args: [
        {
          abiName: "grant",
          publicName: "grant",
          type: spec.interfaces[0]!.methods[0]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[0]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
        {
          selector: 0xe8abb072f5171148n,
          name: "ERC20PermitError",
          type: spec.interfaces[0]!.throws[1]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    increaseAllowanceSigned: __gh_client_contract.defineContractMethod<
      ERC20Permit.v0_1.IncreaseAllowanceSignedArgs,
      ERC20Permit.v0_1.IncreaseAllowanceSignedResult,
      ERC20Permit.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Permit",
      interfaceVersion: "0.1.41",
      abiName: "increase_allowance_signed",
      publicName: "increaseAllowanceSigned",
      entrypoint: __gh_entrypoints.ERC20Permit.v0_1.increaseAllowanceSigned,
      effect: spec.interfaces[0]!.methods[1]!.effect,
      args: [
        {
          abiName: "grant",
          publicName: "grant",
          type: spec.interfaces[0]!.methods[1]!.args[0]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[1]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
        {
          selector: 0xe8abb072f5171148n,
          name: "ERC20PermitError",
          type: spec.interfaces[0]!.throws[1]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
    transferFromSigned: __gh_client_contract.defineContractMethod<
      ERC20Permit.v0_1.TransferFromSignedArgs,
      ERC20Permit.v0_1.TransferFromSignedResult,
      ERC20Permit.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Permit",
      interfaceVersion: "0.1.41",
      abiName: "transfer_from_signed",
      publicName: "transferFromSigned",
      entrypoint: __gh_entrypoints.ERC20Permit.v0_1.transferFromSigned,
      effect: spec.interfaces[0]!.methods[2]!.effect,
      args: [
        {
          abiName: "grant",
          publicName: "grant",
          type: spec.interfaces[0]!.methods[2]!.args[0]!.ty,
        },
        {
          abiName: "receiver",
          publicName: "receiver",
          type: spec.interfaces[0]!.methods[2]!.args[1]!.ty,
        },
        {
          abiName: "amount",
          publicName: "amount",
          type: spec.interfaces[0]!.methods[2]!.args[2]!.ty,
        },
      ],
      returnType: spec.interfaces[0]!.methods[2]!.return_type,
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
        {
          selector: 0xe8abb072f5171148n,
          name: "ERC20PermitError",
          type: spec.interfaces[0]!.throws[1]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const groundhog_erc20_if = {
  v0_1: {
    error: {
      ERC20Error: {
        AlreadyInitialized: 1n,
        MustBeContractOwner: 2n,
        TooLarge: 3n,
        BalanceNotZero: 4n,
        Internal: 100n,
      },
    },
  },
} as const;

export const groundhog_erc20_permit_if = {
  v0_1: {
    error: {
      ERC20PermitError: {
        NotSpender: 1n,
        ExceedsGrant: 2n,
      },
    },
  },
} as const;

// The types the namespaces above refer to, under names no declaration can capture.
export namespace __gh_codegen {
  export type groundhog_erc20_if$v0_1$error$ERC20Error =
    groundhog_erc20_if.v0_1.error.ERC20Error;
  export type groundhog_erc20_permit_if$v0_1$ClearAllowanceGrant =
    groundhog_erc20_permit_if.v0_1.ClearAllowanceGrant;
  export type groundhog_erc20_permit_if$v0_1$PermitGrant =
    groundhog_erc20_permit_if.v0_1.PermitGrant;
  export type groundhog_erc20_permit_if$v0_1$error$ERC20PermitError =
    groundhog_erc20_permit_if.v0_1.error.ERC20PermitError;
}
