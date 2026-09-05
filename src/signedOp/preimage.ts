import type {
  BlockHeight,
  ContractAddress,
  NetworkHash,
} from "@groundhogchain/protocol";
import { CxsWriter, Uint64Codec, codec } from "@groundhogchain/protocol";
import {
  codec as contractSpecCodec,
  type ContractTypeDef,
} from "@groundhogchain/contract-spec";
import { SIGNED_OP } from "../derivation/domainSeparator.js";

/** Everything a signed-operation signature commits to. */
export interface SignedOperationPreimage {
  /** Hash of the network the operation is valid on. */
  readonly network: NetworkHash;
  /** Address of the contract entitled to act on the operation. */
  readonly verifyingContract: ContractAddress;
  /**
   * Spec definition of the payload type, as a generated binding ships it in
   * `spec.type_defs`. Part of the signed bytes, so a signature over one
   * payload type is never a signature over another with the same encoding.
   */
  readonly typeDef: ContractTypeDef;
  /** The signer's sequence number at the verifying contract. */
  readonly nonce: bigint;
  /** Last block height (inclusive) at which the operation may execute. */
  readonly validUntil: BlockHeight;
  /** CXS encoding of the payload value. */
  readonly body: Uint8Array;
}

/**
 * The message a signed-operation signature covers:
 *
 * ```text
 * cxs(DomainSeparator("SignedOp")) || network || verifyingContract
 *     || cxs(typeDef) || cxs(nonce) || cxs(validUntil) || body
 * ```
 *
 * The result is signed directly, like {@link transactionSignaturePreimage};
 * Ed25519 does its own hashing. It must match the Rust
 * `groundhog_domain_separator::SignedOp::preimage` byte for byte, or the
 * verifying contract rejects the signature. Only the first 74 bytes are
 * fixed-width: `nonce` and `validUntil` are CXS varints.
 *
 * {@link defineSignedOperation} calls this after encoding the payload; reach
 * for it directly only when the payload is already CXS bytes.
 */
export function signedOperationPreimage(
  preimage: SignedOperationPreimage,
): Uint8Array {
  const writer = new CxsWriter();
  writer.writeFixedOpaque(preimage.network, 32);
  writer.writeFixedOpaque(preimage.verifyingContract, 32);
  contractSpecCodec.ContractTypeDef.encode(writer, preimage.typeDef);
  Uint64Codec.encode(writer, preimage.nonce);
  codec.BlockHeight.encode(writer, preimage.validUntil);
  writer.writeFixedOpaque(preimage.body, preimage.body.length);
  const payload = writer.finish();

  const prefix = SIGNED_OP.bytes;
  const message = new Uint8Array(prefix.length + payload.length);
  message.set(prefix, 0);
  message.set(payload, prefix.length);
  return message;
}
