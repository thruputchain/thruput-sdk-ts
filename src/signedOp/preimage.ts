import type {
  BlockHeight,
  ContractAddress,
  NetworkHash,
} from "@thruputchain/protocol";
import { CxsWriter, codec } from "@thruputchain/protocol";
import {
  codec as contractSpecCodec,
  type ContractTypeDef,
} from "@thruputchain/contract-spec";
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
  /** Last block height (inclusive) at which the operation may execute. */
  readonly blockExpiryHeight: BlockHeight;
  /**
   * Signer-chosen value that, with `blockExpiryHeight`, the verifying
   * contract consumes exactly once.
   */
  readonly nonce: bigint;
  /** CXS encoding of the payload value. */
  readonly body: Uint8Array;
}

/**
 * The message a signed-operation signature covers:
 *
 * ```text
 * cxs(DomainSeparator("SignedOp")) || network || verifyingContract
 *     || cxs(typeDef) || cxs(uniquifier) || body
 * ```
 *
 * where `cxs(uniquifier)` is `cxs(blockExpiryHeight) || cxs(nonce)`: the
 * chain's own `Uniquifier` encoding, so the replay pair is spelled the way a
 * transaction spells its own. The result is signed directly, like
 * {@link transactionSignaturePreimage}; Ed25519 does its own hashing. It must
 * match the Rust `thruput_domain_separator::SignedOp::preimage` byte for
 * byte, or the verifying contract rejects the signature. Only the first 74
 * bytes are fixed-width: the uniquifier's two fields are CXS varints.
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
  codec.Uniquifier.encode(writer, {
    block_expiry_height: preimage.blockExpiryHeight,
    nonce: preimage.nonce,
  });
  writer.writeFixedOpaque(preimage.body, preimage.body.length);
  const payload = writer.finish();

  const prefix = SIGNED_OP.bytes;
  const message = new Uint8Array(prefix.length + payload.length);
  message.set(prefix, 0);
  message.set(payload, prefix.length);
  return message;
}
