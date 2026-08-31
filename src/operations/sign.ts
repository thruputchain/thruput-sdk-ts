import type { Signature } from "@groundhogchain/protocol";
import type { Signer } from "../signers/types.js";
import type { SignedOperation } from "./preimage.js";
import { signedOperationPreimage } from "./preimage.js";

/**
 * The wire form of an operation, as the contract's `execute_signed_op`
 * entrypoint receives it.
 *
 * The network hash and the verifying contract are deliberately absent. Both are
 * covered by the signature, but a verifier must supply them from what it knows
 * rather than from what a submitter sends — taking them off the wire would let
 * a submitter name the network and contract the signature was meant for, which
 * is the replay those fields exist to stop.
 */
export interface WireOperation {
  readonly type_id: bigint;
  readonly nonce: bigint;
  readonly valid_until: bigint;
  readonly body: Uint8Array;
}

/**
 * Strip a {@link SignedOperation} down to what travels to the contract.
 *
 * @example
 * ```ts
 * const signature = await signOperation(signer, op);
 * await wallet.execute_signed_op(toWireOperation(op), signature.ed25519);
 * ```
 */
export function toWireOperation(op: SignedOperation): WireOperation {
  return {
    type_id: op.typeId,
    nonce: op.nonce,
    valid_until: op.validUntil,
    body: op.body,
  };
}

/**
 * Sign an operation, producing a signature the verifying contract will accept.
 *
 * The signer signs {@link signedOperationPreimage} directly — there is no
 * pre-hash, matching how transactions are signed.
 *
 * Read `nonce` from the verifying contract's `signed_op_nonce(signer)` before
 * building the operation; a stale nonce is refused, and a signature is spent
 * once.
 *
 * @example
 * ```ts
 * import { operationTypeId } from "@groundhogchain/client";
 * import { signOperation } from "@groundhogchain/client/operations";
 * import { PrivateKeySigner } from "@groundhogchain/client/signers";
 *
 * const signer = new PrivateKeySigner(secretKey);
 * const signature = await signOperation(signer, {
 *   network: networkHash,
 *   verifyingContract: walletAddress,
 *   typeId: operationTypeId("MyWallet", "0.1.0", "transfer"),
 *   nonce: await wallet.signed_op_nonce(signerAddress),
 *   validUntil: currentHeight + 100n,
 *   body: encodedTransferArgs,
 * });
 * ```
 */
export async function signOperation(
  signer: Signer,
  op: SignedOperation,
): Promise<Signature> {
  return signer.sign(signedOperationPreimage(op));
}
