import type { ContractAddress, NetworkHash } from "@groundhogchain/protocol";
import {
  CryptographicScheme,
  blockHeight,
  ed25519PublicKey,
  ed25519Signature,
} from "@groundhogchain/protocol";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  contractSpecString,
  type ContractTypeDef,
} from "@groundhogchain/contract-spec";
import type { FixedBytes } from "@groundhogchain/xdr";
import {
  createContractCodec,
  createContractCodecContext,
} from "../contract/codec.js";
import type { Signer } from "../signers/types.js";
import { signedOperationPreimage } from "./preimage.js";

/**
 * Wire form of a signed operation: the `Operation` struct of the
 * `groundhog-signed-op-if` interface, in the shape generated bindings give it.
 *
 * The network hash and verifying contract are covered by the signature but
 * deliberately absent here: the verifying contract supplies them from its own
 * syscalls, so a submitter cannot name the network or contract a signature was
 * meant for.
 */
export interface Operation {
  /** Ed25519 public key that signed the operation. */
  signer: FixedBytes<32>;
  /** The signer's sequence number at the verifying contract. */
  nonce: bigint;
  /** Last block height (inclusive) at which the operation may execute. */
  valid_until: bigint;
  /** CXS encoding of the payload value. */
  body: Uint8Array;
}

/** An {@link Operation} and the Ed25519 signature over its preimage. */
export interface SignedOperation {
  readonly op: Operation;
  readonly signature: FixedBytes<64>;
}

/** What a signer supplies to produce one operation. */
export interface SignedOperationRequest<TBody> {
  /** Hash of the network the operation is valid on. */
  readonly network: NetworkHash;
  /** Address of the contract that will verify and act on the operation. */
  readonly verifyingContract: ContractAddress;
  /**
   * The signer's next sequence number at the verifying contract, as returned
   * by the contract's `next_signed_op_nonce` view.
   */
  readonly nonce: bigint;
  /** Last block height (inclusive) at which the operation may execute. */
  readonly validUntil: bigint;
  /** The payload value, in the field shape generated bindings use. */
  readonly body: TBody;
}

/** Signing helpers bound to one payload type. */
export interface SignedOperationType<TBody> {
  /** Name of the payload type in the contract spec. */
  readonly typeName: string;
  /** The payload type's spec definition, as bound into every preimage. */
  readonly typeDef: ContractTypeDef;
  /** CXS-encode a payload value the way the contract decodes it. */
  encodeBody(body: TBody): Uint8Array;
  /** The bytes a signature over `request` covers. */
  preimage(request: SignedOperationRequest<TBody>): Uint8Array;
  /** Encode, sign, and package `request` for the verifying contract. */
  sign(
    signer: Signer,
    request: SignedOperationRequest<TBody>,
  ): Promise<SignedOperation>;
}

/** Options for {@link defineSignedOperation}. */
export interface DefineSignedOperationOptions {
  /**
   * Type definitions the payload type is resolved against: a generated
   * binding's `spec.type_defs`, which carries the payload type and every type
   * it references.
   */
  readonly typeDefs: readonly ContractTypeDef[];
  /** Name of the payload type, as declared with `#[contract_type]`. */
  readonly typeName: string;
}

/**
 * Bind signing helpers to a `#[contract_type]` payload.
 *
 * A signed operation authorizes an on-chain action off-chain, so the signer
 * need not submit the transaction: the pattern behind permits, session keys,
 * and delegated wallet actions. The verifying contract embeds
 * `groundhog_signed_op::SignedOpNonces` and checks the operation with
 * `verify_and_spend::<Payload>`; this is the client half, producing the
 * `Operation` and signature that contract expects.
 *
 * @example
 * ```ts
 * import { defineSignedOperation } from "@groundhogchain/client/signed-op";
 * import { spec, MyWallet, type Transfer } from "./generated/my_wallet.js";
 *
 * const transfer = defineSignedOperation<Transfer>({
 *   typeDefs: spec.type_defs,
 *   typeName: "Transfer",
 * });
 * const { op, signature } = await transfer.sign(signer, {
 *   network: networkHash,
 *   verifyingContract: walletAddress,
 *   nonce: await SignedOp.nextSignedOpNonce.view({ client, contract: walletAddress, args: { signer: publicKey } }).then((v) => v.value),
 *   validUntil: currentHeight + 100n,
 *   body: { to: recipient, amount: 42n },
 * });
 * // `op` and `signature` are the arguments of the contract's execute entrypoint.
 * const invocation = MyWallet.submit.invocation(walletAddress, gasLimit, { op, signature });
 * ```
 *
 * @throws If `typeName` is not among `typeDefs`.
 */
export function defineSignedOperation<TBody>(
  options: DefineSignedOperationOptions,
): SignedOperationType<TBody> {
  // Snapshot once: the codec context clones what it is given, so the
  // definition bound into every preimage must come from the same frozen copy
  // or a later mutation of the caller's array would split the two.
  const typeDefs = structuredClone([...options.typeDefs]);
  const typeDef = deepFreeze(findTypeDef(typeDefs, options.typeName));
  const context = createContractCodecContext(typeDefs);
  const bodyCodec = createContractCodec<TBody>(
    context,
    { v: ContractTypeKind.Named, named: contractSpecString(options.typeName) },
    `${options.typeName} payload`,
  );

  const preimageOf = (
    request: SignedOperationRequest<TBody>,
    body: Uint8Array,
  ): Uint8Array =>
    signedOperationPreimage({
      network: request.network,
      verifyingContract: request.verifyingContract,
      typeDef,
      nonce: request.nonce,
      validUntil: blockHeight(request.validUntil),
      body,
    });

  return {
    typeName: options.typeName,
    typeDef,
    encodeBody: (body) => bodyCodec.encode(body),
    preimage: (request) => preimageOf(request, bodyCodec.encode(request.body)),
    async sign(signer, request) {
      const publicKey = signer.publicKey;
      if (publicKey.scheme !== CryptographicScheme.Ed25519) {
        throw new Error("Signed operations require an Ed25519 signer");
      }
      // A custom signer's bytes are untrusted: the constructors reject any
      // length but the 32 and 64 the wire struct's fixed arrays encode.
      const signerKey = ed25519PublicKey(publicKey.ed25519);
      const body = bodyCodec.encode(request.body);
      const signature = await signer.sign(preimageOf(request, body));
      if (signature.scheme !== CryptographicScheme.Ed25519) {
        throw new Error("Signer did not return an Ed25519 signature");
      }
      return {
        op: {
          signer: signerKey,
          nonce: request.nonce,
          valid_until: request.validUntil,
          body,
        },
        signature: ed25519Signature(signature.ed25519),
      };
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as object)) {
      deepFreeze(inner);
    }
  }
  return value;
}

function typeDefName(typeDef: ContractTypeDef): string {
  switch (typeDef.v) {
    case ContractTypeDefKind.TypeDefStruct:
      return typeDef.struct_def.name;
    case ContractTypeDefKind.TypeDefEnum:
      return typeDef.enum_def.name;
    case ContractTypeDefKind.TypeDefUnion:
      return typeDef.union_def.name;
  }
}

function findTypeDef(
  typeDefs: readonly ContractTypeDef[],
  typeName: string,
): ContractTypeDef {
  const typeDef = typeDefs.find((def) => typeDefName(def) === typeName);
  if (typeDef === undefined) {
    throw new Error(
      `Contract type "${typeName}" is not defined in the given type definitions`,
    );
  }
  return typeDef;
}
