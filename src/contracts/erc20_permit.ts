// Generated from erc20_permit.spec.xdr - ERC20Permit interface v0.1.68
// DO NOT EDIT. Re-run codegen to update.

import * as __gh_protocol from "@thruputchain/protocol";
import * as __gh_protocol_utils from "@thruputchain/protocol/utils";
import * as __gh_contract_spec from "@thruputchain/contract-spec";
import * as __gh_client_contract from "../contract/index.js";

const __gh_s = __gh_contract_spec.contractSpecString;

const __gh_entrypoints = {
  ERC20Permit: {
    v0_1: {
      deleteAllowanceSigned: __gh_protocol.contractEntrypointID(
        __gh_protocol_utils.fromHex("0a791be04a1d1c4b"),
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

export namespace thruput_erc20_if {
  export namespace v0_1 {
    export namespace error {
      export type ERC20Error = 1n | 2n | 3n | 4n | 5n | 100n;
    }
  }
}

export namespace thruput_erc20_permit_if {
  export namespace v0_1 {
    export interface DeleteAllowanceGrant {
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
    export interface DeleteAllowanceSignedArgs {
      grant: __gh_client_contract.SignedToken<__gh_codegen.thruput_erc20_permit_if$v0_1$DeleteAllowanceGrant>;
    }
    export type DeleteAllowanceSignedResult = void;

    export interface IncreaseAllowanceSignedArgs {
      grant: __gh_client_contract.SignedToken<__gh_codegen.thruput_erc20_permit_if$v0_1$PermitGrant>;
    }
    export type IncreaseAllowanceSignedResult = void;

    export interface TransferFromSignedArgs {
      grant: __gh_client_contract.SignedToken<__gh_codegen.thruput_erc20_permit_if$v0_1$PermitGrant>;
      receiver: __gh_protocol.ContractAddress;
      amount: bigint;
    }
    export type TransferFromSignedResult = void;

    export type DeclaredException =
      | {
          kind: "declared";
          name: "ERC20PermitError";
          selector: 0x1aaf2b9becb7ddc4n;
          value: __gh_codegen.thruput_erc20_permit_if$v0_1$error$ERC20PermitError;
        }
      | {
          kind: "declared";
          name: "ERC20Error";
          selector: 0xf63c8b1f5e7e2fe0n;
          value: __gh_codegen.thruput_erc20_if$v0_1$error$ERC20Error;
        };
    export type Exception =
      __gh_client_contract.ContractException<DeclaredException>;
  }
}

export const spec: __gh_client_contract.ContractSpec = {
  interfaces: [
    {
      name: __gh_s("ERC20Permit"),
      vers: __gh_s("0.1.68"),
      throws: [
        {
          selector: 0x1aaf2b9becb7ddc4n,
          ty: {
            v: __gh_contract_spec.ContractTypeKind.Named,
            named: {
              crate_name: __gh_s("thruput-erc20-permit-if"),
              major: __gh_s("0.1"),
              module_path: __gh_s("thruput_erc20_permit_if::error"),
              declared: __gh_s("ERC20PermitError"),
            },
          },
        },
        {
          selector: 0xf63c8b1f5e7e2fe0n,
          ty: {
            v: __gh_contract_spec.ContractTypeKind.Named,
            named: {
              crate_name: __gh_s("thruput-erc20-if"),
              major: __gh_s("0.1"),
              module_path: __gh_s("thruput_erc20_if::error"),
              declared: __gh_s("ERC20Error"),
            },
          },
        },
      ],
      methods: [
        {
          name: __gh_s("delete_allowance_signed"),
          args: [
            {
              name: __gh_s("grant"),
              ty: {
                v: __gh_contract_spec.ContractTypeKind.SignedToken,
                signed_token_preimage: {
                  preimage_type: {
                    v: __gh_contract_spec.ContractTypeKind.Named,
                    named: {
                      crate_name: __gh_s("thruput-erc20-permit-if"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("thruput_erc20_permit_if"),
                      declared: __gh_s("DeleteAllowanceGrant"),
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
                      crate_name: __gh_s("thruput-erc20-permit-if"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("thruput_erc20_permit_if"),
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
                      crate_name: __gh_s("thruput-erc20-permit-if"),
                      major: __gh_s("0.1"),
                      module_path: __gh_s("thruput_erc20_permit_if"),
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
              ty: { v: __gh_contract_spec.ContractTypeKind.I128 },
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
          crate_name: __gh_s("thruput-erc20-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("thruput_erc20_if::error"),
          declared: __gh_s("ERC20Error"),
        },
        variants: [
          { name: __gh_s("AlreadyInitialized"), value: 1n },
          { name: __gh_s("MustBeContractOwner"), value: 2n },
          { name: __gh_s("TooLarge"), value: 3n },
          { name: __gh_s("BalanceNotZero"), value: 4n },
          { name: __gh_s("NegativeAmount"), value: 5n },
          { name: __gh_s("Internal"), value: 100n },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefStruct,
      struct_def: {
        name: {
          crate_name: __gh_s("thruput-erc20-permit-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("thruput_erc20_permit_if"),
          declared: __gh_s("DeleteAllowanceGrant"),
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
          crate_name: __gh_s("thruput-erc20-permit-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("thruput_erc20_permit_if"),
          declared: __gh_s("PermitGrant"),
        },
        fields: [
          {
            name: __gh_s("spender"),
            ty: { v: __gh_contract_spec.ContractTypeKind.Address },
          },
          {
            name: __gh_s("amount"),
            ty: { v: __gh_contract_spec.ContractTypeKind.I128 },
          },
        ],
      },
    },
    {
      v: __gh_contract_spec.ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: {
          crate_name: __gh_s("thruput-erc20-permit-if"),
          major: __gh_s("0.1"),
          module_path: __gh_s("thruput_erc20_permit_if::error"),
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
    deleteAllowanceSigned: __gh_client_contract.defineContractMethod<
      ERC20Permit.v0_1.DeleteAllowanceSignedArgs,
      ERC20Permit.v0_1.DeleteAllowanceSignedResult,
      ERC20Permit.v0_1.DeclaredException
    >({
      interfaceName: "ERC20Permit",
      interfaceVersion: "0.1.68",
      abiName: "delete_allowance_signed",
      publicName: "deleteAllowanceSigned",
      entrypoint: __gh_entrypoints.ERC20Permit.v0_1.deleteAllowanceSigned,
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
          selector: 0x1aaf2b9becb7ddc4n,
          name: "ERC20PermitError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
        {
          selector: 0xf63c8b1f5e7e2fe0n,
          name: "ERC20Error",
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
      interfaceVersion: "0.1.68",
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
          selector: 0x1aaf2b9becb7ddc4n,
          name: "ERC20PermitError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
        {
          selector: 0xf63c8b1f5e7e2fe0n,
          name: "ERC20Error",
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
      interfaceVersion: "0.1.68",
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
          selector: 0x1aaf2b9becb7ddc4n,
          name: "ERC20PermitError",
          type: spec.interfaces[0]!.throws[0]!.ty,
        },
        {
          selector: 0xf63c8b1f5e7e2fe0n,
          name: "ERC20Error",
          type: spec.interfaces[0]!.throws[1]!.ty,
        },
      ],
      codecs: __gh_codecs,
    }),
  },
} as const;

export const thruput_erc20_if = {
  v0_1: {
    error: {
      ERC20Error: {
        AlreadyInitialized: 1n,
        MustBeContractOwner: 2n,
        TooLarge: 3n,
        BalanceNotZero: 4n,
        NegativeAmount: 5n,
        Internal: 100n,
      },
    },
  },
} as const;

export const thruput_erc20_permit_if = {
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
  export type thruput_erc20_if$v0_1$error$ERC20Error =
    thruput_erc20_if.v0_1.error.ERC20Error;
  export type thruput_erc20_permit_if$v0_1$DeleteAllowanceGrant =
    thruput_erc20_permit_if.v0_1.DeleteAllowanceGrant;
  export type thruput_erc20_permit_if$v0_1$PermitGrant =
    thruput_erc20_permit_if.v0_1.PermitGrant;
  export type thruput_erc20_permit_if$v0_1$error$ERC20PermitError =
    thruput_erc20_permit_if.v0_1.error.ERC20PermitError;
}
