/**
 * Off-chain signing of operations that a contract verifies on chain.
 *
 * A signed operation is a `#[contract_type]` payload plus the fields that stop
 * its signature being replayed: the network, the verifying contract, a
 * per-signer nonce, and an expiry height. {@link defineSignedOperation} binds
 * a payload type from a generated binding's spec and produces the `Operation`
 * and signature the contract's `execute_signed_op` expects; {@link SignedOp}
 * queries the nonce to sign with.
 *
 * The bytes signed are defined by the Rust `groundhog-domain-separator`
 * crate's `SignedOp` and verified by the `groundhog-signed-op` component.
 *
 * @module
 */
export {
  defineSignedOperation,
  type DefineSignedOperationOptions,
  type Operation,
  type SignedOperation,
  type SignedOperationRequest,
  type SignedOperationType,
} from "./operation.js";
export {
  signedOperationPreimage,
  type SignedOperationPreimage,
} from "./preimage.js";
export {
  SIGNED_OP_INTERFACE_VERSION,
  SignedOp,
  SignedOpError,
  signedOpTypeDefs,
  type SignedOpDeclaredException,
  type SignedOpException,
  type SignedOpExecuteSignedOpArgs,
  type SignedOpNextSignedOpNonceArgs,
} from "./interface.js";
