import type { ContractAddress, NetworkHash } from "@groundhogchain/protocol";
import {
  CryptographicScheme,
  blockHeight,
  ed25519Signature,
} from "@groundhogchain/protocol";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  contractSpecString,
  type ContractTypeDef,
} from "@groundhogchain/contract-spec";
import type { FixedBytes } from "@groundhogchain/xdr";
import { randomBytes } from "@noble/hashes/utils.js";
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
 * The network hash, the verifying contract, and the signing key are covered
 * by the signature but deliberately absent here. The verifying contract
 * supplies the first two from its own syscalls and checks the signature
 * against the key it holds, so a submitter can name neither the network or
 * contract a signature was meant for nor the key it is checked against.
 *
 * `block_expiry_height` and `nonce` are the chain's `Uniquifier`, in its
 * field order, so their encoding is byte for byte a transaction's.
 */
export interface Operation {
  /** Last block height (inclusive) at which the operation may execute. */
  block_expiry_height: bigint;
  /**
   * Chosen by the signer: any value, as long as the pair
   * `(nonce, block_expiry_height)` has not been consumed at the verifying
   * contract. There is no ordering. Consumed pairs are the contract's, not
   * the key's, so where several keys sign for one contract, draw nonces at
   * random ({@link randomNonce}) rather than counting; a lone key may do
   * either.
   */
  nonce: bigint;
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
  /** Last block height (inclusive) at which the operation may execute. */
  readonly blockExpiryHeight: bigint;
  /**
   * Signer-chosen replay guard; see {@link Operation.nonce}. Nothing on
   * chain needs reading to pick one: {@link randomNonce} is always safe.
   */
  readonly nonce: bigint;
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
 * A uniformly random `u64` for {@link Operation.nonce}.
 *
 * Consumed `(nonce, block_expiry_height)` pairs are scoped to the verifying
 * contract, not to the signing key, so a random nonce is the choice that
 * stays safe when several keys sign for one contract; a lone key may count
 * instead. Draws from the platform's `crypto.getRandomValues`.
 */
export function randomNonce(): bigint {
  let nonce = 0n;
  for (const byte of randomBytes(8)) {
    nonce = (nonce << 8n) | BigInt(byte);
  }
  return nonce;
}

/**
 * Bind signing helpers to a `#[contract_type]` payload.
 *
 * A signed operation authorizes an on-chain action off-chain, so the signer
 * need not submit the transaction: the pattern behind permits, session keys,
 * and delegated wallet actions. The verifying contract embeds
 * `groundhog_signed_op::SignedOpReplayCache` and checks the operation with
 * `consume::<Payload>` against the key it holds; this is the client half,
 * producing the `Operation` and signature that contract expects.
 *
 * @example
 * ```ts
 * import {
 *   defineSignedOperation,
 *   randomNonce,
 * } from "@groundhogchain/client/signed-op";
 * import { spec, MyWallet, type Transfer } from "./generated/my_wallet.js";
 *
 * const transfer = defineSignedOperation<Transfer>({
 *   typeDefs: spec.type_defs,
 *   typeName: "Transfer",
 * });
 * const { op, signature } = await transfer.sign(signer, {
 *   network: networkHash,
 *   verifyingContract: walletAddress,
 *   blockExpiryHeight: currentHeight + 100n,
 *   nonce: randomNonce(),
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
    blockExpiryHeight: bigint,
    nonce: bigint,
    body: Uint8Array,
  ): Uint8Array =>
    signedOperationPreimage({
      network: request.network,
      verifyingContract: request.verifyingContract,
      typeDef,
      blockExpiryHeight: blockHeight(blockExpiryHeight),
      nonce,
      body,
    });

  return {
    typeName: options.typeName,
    typeDef,
    encodeBody: (body) => bodyCodec.encode(body),
    preimage: (request) =>
      preimageOf(
        request,
        request.blockExpiryHeight,
        request.nonce,
        bodyCodec.encode(request.body),
      ),
    async sign(signer, request) {
      if (signer.publicKey.scheme !== CryptographicScheme.Ed25519) {
        throw new Error("Signed operations require an Ed25519 signer");
      }
      // Everything the returned operation carries is taken before the signer
      // is awaited, so a request mutated while a wallet prompt is pending
      // cannot make the operation disagree with the message that was signed.
      // The signature bytes are copied for the same reason, and the
      // constructor rejects any length but the 64 the wire struct's fixed
      // array encodes.
      const blockExpiryHeight = request.blockExpiryHeight;
      const nonce = request.nonce;
      const body = bodyCodec.encode(request.body);
      const message = preimageOf(request, blockExpiryHeight, nonce, body);
      const signature = await signer.sign(message);
      if (signature.scheme !== CryptographicScheme.Ed25519) {
        throw new Error("Signer did not return an Ed25519 signature");
      }
      return {
        op: { block_expiry_height: blockExpiryHeight, nonce, body },
        signature: ed25519Signature(new Uint8Array(signature.ed25519)),
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
