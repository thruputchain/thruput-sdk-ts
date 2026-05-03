// Generated from itc_erc20.spec.json — ERC20 interface v0.1.0
// DO NOT EDIT. Re-run codegen to update.

import type {
  ContractAddress,
  GasAmount,
  Invocation,
  Calldata,
  ContractEntrypointID,
} from "@groundhogchain/protocol";
import {
  contractEntrypointID,
  calldata,
  gasAmount,
} from "@groundhogchain/protocol";
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
  adjust_allowance: contractEntrypointID(fromHex("c4b1fa34fd3c9d9f")),
  allowance: contractEntrypointID(fromHex("fc18bdc3a40e0af4")),
  burn: contractEntrypointID(fromHex("b4ede8d7d4ebdadf")),
  get_balance: contractEntrypointID(fromHex("7a44649d55cabda8")),
  get_balance_of: contractEntrypointID(fromHex("73c9aac12bd15a84")),
  initialize: contractEntrypointID(fromHex("156e09b3a38b530b")),
  mint: contractEntrypointID(fromHex("4d6bef07494b13e5")),
  total_supply: contractEntrypointID(fromHex("cf0aa4a820e30216")),
  transfer: contractEntrypointID(fromHex("3799fd1c3d9b098f")),
  transfer_from: contractEntrypointID(fromHex("40365e271f8d6982")),
} as const;

export const spec: ContractSpec = {
  interfaces: [
    {
      name: s("ERC20"),
      vers: s("0.1.0"),
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          ty: { v: ContractTypeKind.Named, named: s("ERC20Error") },
        },
      ],
      methods: [
        {
          name: s("adjust_allowance"),
          args: [
            { name: s("spender"), ty: { v: ContractTypeKind.Address } },
            { name: s("diff"), ty: { v: ContractTypeKind.I128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("allowance"),
          args: [
            { name: s("owner"), ty: { v: ContractTypeKind.Address } },
            { name: s("spender"), ty: { v: ContractTypeKind.Address } },
          ],
          return_type: { v: ContractTypeKind.U128 },
        },
        {
          name: s("burn"),
          args: [
            { name: s("owner"), ty: { v: ContractTypeKind.Address } },
            { name: s("amount"), ty: { v: ContractTypeKind.U128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("get_balance"),
          args: [],
          return_type: { v: ContractTypeKind.U128 },
        },
        {
          name: s("get_balance_of"),
          args: [{ name: s("addr"), ty: { v: ContractTypeKind.Address } }],
          return_type: { v: ContractTypeKind.U128 },
        },
        {
          name: s("initialize"),
          args: [
            {
              name: s("contract_owner"),
              ty: { v: ContractTypeKind.Address },
            },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("mint"),
          args: [
            { name: s("receiver"), ty: { v: ContractTypeKind.Address } },
            { name: s("amount"), ty: { v: ContractTypeKind.U128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("total_supply"),
          args: [],
          return_type: { v: ContractTypeKind.U128 },
        },
        {
          name: s("transfer"),
          args: [
            { name: s("to"), ty: { v: ContractTypeKind.Address } },
            { name: s("amount"), ty: { v: ContractTypeKind.U128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("transfer_from"),
          args: [
            { name: s("owner"), ty: { v: ContractTypeKind.Address } },
            { name: s("receiver"), ty: { v: ContractTypeKind.Address } },
            { name: s("amount"), ty: { v: ContractTypeKind.U128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: s("ERC20Error"),
        variants: [
          { name: s("AlreadyInitialized"), value: 1n },
          { name: s("MustBeContractOwner"), value: 2n },
          { name: s("TooLarge"), value: 3n },
          { name: s("Internal"), value: 100n },
        ],
      },
    },
  ],
};

const namedCodecs = buildNamedCodecs(spec.type_defs);

export function transfer(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { to: ContractAddress; amount: bigint },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.transfer,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "transfer",
      [args.to, args.amount],
      namedCodecs,
    ),
  });
}

export function transferFrom(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: {
    owner: ContractAddress;
    receiver: ContractAddress;
    amount: bigint;
  },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.transfer_from,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "transfer_from",
      [args.owner, args.receiver, args.amount],
      namedCodecs,
    ),
  });
}

export function mint(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { receiver: ContractAddress; amount: bigint },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.mint,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "mint",
      [args.receiver, args.amount],
      namedCodecs,
    ),
  });
}

export function burn(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { owner: ContractAddress; amount: bigint },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.burn,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "burn",
      [args.owner, args.amount],
      namedCodecs,
    ),
  });
}

export function adjustAllowance(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { spender: ContractAddress; diff: bigint },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.adjust_allowance,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "adjust_allowance",
      [args.spender, args.diff],
      namedCodecs,
    ),
  });
}

export function allowance(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { owner: ContractAddress; spender: ContractAddress },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.allowance,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "allowance",
      [args.owner, args.spender],
      namedCodecs,
    ),
  });
}

export function getBalance(
  contract: ContractAddress,
  gasLimit: GasAmount,
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.get_balance,
    gas_limit: gasLimit,
    calldata: encodeCalldata(spec, "ERC20", "get_balance", [], namedCodecs),
  });
}

export function getBalanceOf(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { addr: ContractAddress },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.get_balance_of,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "get_balance_of",
      [args.addr],
      namedCodecs,
    ),
  });
}

export function initialize(
  contract: ContractAddress,
  gasLimit: GasAmount,
  args: { contractOwner: ContractAddress },
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.initialize,
    gas_limit: gasLimit,
    calldata: encodeCalldata(
      spec,
      "ERC20",
      "initialize",
      [args.contractOwner],
      namedCodecs,
    ),
  });
}

export function totalSupply(
  contract: ContractAddress,
  gasLimit: GasAmount,
): Invocation {
  return createInvocation({
    invoked_address: contract,
    entrypoint: entrypoints.total_supply,
    gas_limit: gasLimit,
    calldata: encodeCalldata(spec, "ERC20", "total_supply", [], namedCodecs),
  });
}
