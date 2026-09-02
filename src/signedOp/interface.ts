// Hand-maintained mirror of the `groundhog-signed-op-if` 0.1.19 interface
// spec (`specs/contracts/signed_op.spec.xdr`). `execute_signed_op` returns
// auth tokens, which the pinned binding generator release does not emit yet,
// so the interface cannot go through `scripts/regenerate-contract-bindings.sh`
// until the pin moves. `src/signedOp/interface.test.ts` pins every value here
// to the spec file.

import { contractEntrypointID } from "@groundhogchain/protocol";
import { fromHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  contractSpecString,
  type ContractTypeDef,
} from "@groundhogchain/contract-spec";
import type { FixedBytes } from "@groundhogchain/xdr";
import { createContractCodecContext } from "../contract/codec.js";
import {
  defineContractMethod,
  type ContractException,
} from "../contract/method.js";
import type { SignedToken } from "../contract/signedToken.js";
import type { Operation } from "./operation.js";

const s = contractSpecString;

/** Interface version the entrypoint IDs below are derived from. */
export const SIGNED_OP_INTERFACE_VERSION = "0.1.19";

/** Why a verifying contract refused a signed operation. */
export const SignedOpError = {
  InvalidSignature: 1n,
  Expired: 2n,
  UnexpectedNonce: 3n,
  MalformedBody: 4n,
} as const;

/** One {@link SignedOpError} discriminant. */
export type SignedOpError = (typeof SignedOpError)[keyof typeof SignedOpError];

/** The declared exception of every `SignedOp` method. */
export type SignedOpDeclaredException = {
  kind: "declared";
  name: "SignedOpError";
  selector: 0x65f3de61c8178163n;
  value: SignedOpError;
};

/** Declared or unknown exception raised by a `SignedOp` method. */
export type SignedOpException = ContractException<SignedOpDeclaredException>;

/** Arguments of {@link SignedOp.nextSignedOpNonce}. */
export interface SignedOpNextSignedOpNonceArgs {
  /** Ed25519 public key whose next nonce is asked for. */
  signer: FixedBytes<32>;
}

/** Arguments of {@link SignedOp.executeSignedOp}. */
export interface SignedOpExecuteSignedOpArgs {
  /** The operation, as {@link defineSignedOperation} packages it. */
  op: Operation;
  /** Ed25519 signature over the operation's preimage. */
  signature: FixedBytes<64>;
}

/**
 * Type definitions of the `SignedOp` interface: the `Operation` wire struct
 * and the `SignedOpError` enum.
 */
export const signedOpTypeDefs: readonly ContractTypeDef[] = [
  {
    v: ContractTypeDefKind.TypeDefStruct,
    struct_def: {
      name: s("Operation"),
      fields: [
        {
          name: s("signer"),
          ty: {
            v: ContractTypeKind.Array,
            array: { element: { v: ContractTypeKind.U8 }, len: 32n },
          },
        },
        { name: s("nonce"), ty: { v: ContractTypeKind.U64 } },
        { name: s("valid_until"), ty: { v: ContractTypeKind.I64 } },
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
        { name: s("UnexpectedNonce"), value: 3n },
        { name: s("MalformedBody"), value: 4n },
      ],
    },
  },
];

const codecs = createContractCodecContext(signedOpTypeDefs);

const signedOpThrows = [
  {
    selector: 0x65f3de61c8178163n,
    name: "SignedOpError",
    type: { v: ContractTypeKind.Named, named: s("SignedOpError") },
  },
] as const;

/**
 * Method descriptors for contracts implementing the `SignedOp` standard
 * interface.
 *
 * `executeSignedOp` verifies an operation and returns the auth tokens it
 * mints. Tokens never travel in return data, so a client decodes them as
 * {@link SignedToken} placeholders; it is the calling contract that consumes
 * them on chain. Most applications submit an operation through the entrypoint
 * of the contract that does so, passing the {@link SignedOperation} that
 * {@link defineSignedOperation} produces.
 */
export const SignedOp = {
  /** Verify an operation, spend its nonce, and mint its auth tokens. */
  executeSignedOp: defineContractMethod<
    SignedOpExecuteSignedOpArgs,
    SignedToken[],
    SignedOpDeclaredException
  >({
    entrypoint: contractEntrypointID(fromHex("c281dc2ffb5eeb1e")),
    args: [
      {
        abiName: "op",
        publicName: "op",
        type: { v: ContractTypeKind.Named, named: s("Operation") },
      },
      {
        abiName: "signature",
        publicName: "signature",
        type: {
          v: ContractTypeKind.Array,
          array: { element: { v: ContractTypeKind.U8 }, len: 64n },
        },
      },
    ],
    returnType: {
      v: ContractTypeKind.Vector,
      vector: {
        element: {
          v: ContractTypeKind.SignedToken,
          signed_token_preimage: { preimage_type: null },
        },
        max_len: 4294967295n,
      },
    },
    throws: signedOpThrows,
    codecs,
  }),
  /** The nonce a signer's next operation at this contract must carry. */
  nextSignedOpNonce: defineContractMethod<
    SignedOpNextSignedOpNonceArgs,
    bigint,
    SignedOpDeclaredException
  >({
    entrypoint: contractEntrypointID(fromHex("15796a0d138d2bd5")),
    args: [
      {
        abiName: "signer",
        publicName: "signer",
        type: {
          v: ContractTypeKind.Array,
          array: { element: { v: ContractTypeKind.U8 }, len: 32n },
        },
      },
    ],
    returnType: { v: ContractTypeKind.U64 },
    throws: signedOpThrows,
    codecs,
  }),
} as const;
