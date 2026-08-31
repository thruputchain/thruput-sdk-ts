/**
 * Signed operations: structured messages authorizing an on-chain action,
 * signed off-chain by someone other than the submitter.
 *
 * A transaction signature authorizes a submission and is checked by the
 * validator. An operation signature authorizes an action and is checked by a
 * contract — the pattern behind permits, session keys, meta-transactions and
 * delegated wallet actions. The contract side is
 * `groundhog-signed-op-if` in the Rust SDK.
 *
 * @module
 */
export type { SignedOperation } from "./preimage.js";
export {
  encodeSignedOperation,
  signedOperationId,
  signedOperationPreimage,
} from "./preimage.js";
export type { WireOperation } from "./sign.js";
export { signOperation, toWireOperation } from "./sign.js";
export { operationTypeId } from "../derivation/entrypointId.js";
