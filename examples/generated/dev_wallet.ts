// Generated from dev_wallet.spec.xdr - DevWallet interface v0.1.0.
// DO NOT EDIT generated content. Regenerate, then reapply the local client imports.
// Client imports point at local source so the repository example runs before build.

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
import type { ContractSpec } from "../../src/index.js";
import { encodeCalldata } from "../../src/index.js";
import { buildNamedCodecs } from "../../src/index.js";
import { createInvocation } from "../../src/index.js";

const s = contractSpecString;

const entrypoints = {
  DevWallet: {
    createWallet: contractEntrypointID(fromHex("78b187d37f222827")),
    deploy: contractEntrypointID(fromHex("f969542572bd6860")),
    doAction: contractEntrypointID(fromHex("a0fff94c64fbaf3c")),
    initialize: contractEntrypointID(fromHex("77b7af6606c91791")),
  },
} as const;

export const spec: ContractSpec = {
  interfaces: [
    {
      name: s("DevWallet"),
      vers: s("0.1.0"),
      throws: [],
      methods: [
        {
          name: s("create_wallet"),
          args: [
            {
              name: s("nonce"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 32n },
              },
            },
            {
              name: s("wallet_contract_hash"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 32n },
              },
            },
            {
              name: s("owner"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 32n },
              },
            },
          ],
          return_type: { v: ContractTypeKind.Address },
        },
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
          name: s("do_action"),
          args: [
            {
              name: s("invocation_bytes"),
              ty: {
                v: ContractTypeKind.Vector,
                vector: {
                  element: { v: ContractTypeKind.U8 },
                  max_len: 4294967295n,
                },
              },
            },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("initialize"),
          args: [
            {
              name: s("owner"),
              ty: {
                v: ContractTypeKind.Array,
                array: { element: { v: ContractTypeKind.U8 }, len: 32n },
              },
            },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
      ],
    },
  ],
  type_defs: [],
  events: [],
};

const namedCodecs = buildNamedCodecs(spec.type_defs);

export const DevWallet = {
  createWallet(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: {
      nonce: Uint8Array;
      walletContractHash: Uint8Array;
      owner: Uint8Array;
    },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.DevWallet.createWallet,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "DevWallet",
        "create_wallet",
        [args.nonce, args.walletContractHash, args.owner],
        namedCodecs,
      ),
    });
  },
  deploy(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { nonce: Uint8Array; contractHash: Uint8Array },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.DevWallet.deploy,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "DevWallet",
        "deploy",
        [args.nonce, args.contractHash],
        namedCodecs,
      ),
    });
  },
  doAction(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { invocationBytes: Uint8Array },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.DevWallet.doAction,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "DevWallet",
        "do_action",
        [args.invocationBytes],
        namedCodecs,
      ),
    });
  },
  initialize(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { owner: Uint8Array },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.DevWallet.initialize,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "DevWallet",
        "initialize",
        [args.owner],
        namedCodecs,
      ),
    });
  },
} as const;
