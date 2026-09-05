/**
 * Off-chain signing of operations that a contract verifies on chain.
 *
 * A signed operation is a `#[contract_type]` payload plus the fields that stop
 * its signature being replayed: the network, the verifying contract, and a
 * signer-chosen `(nonce, expiry height)` pair the contract consumes once.
 * {@link defineSignedOperation} binds a payload type from a generated
 * binding's spec and produces the `Operation` and signature the contract's
 * `execute_signed_op` expects; {@link randomNonce} picks a nonce without
 * reading anything on chain.
 *
 * {@link SignedOp} is the generated binding of the `SignedOp` standard
 * interface. `executeSignedOp` verifies an operation, consumes its pair, and
 * mints the one auth token the operation authorizes. Tokens never travel in
 * return data, so a client decodes it as a `SignedToken` placeholder; it is
 * the calling contract that consumes it on chain. Most applications submit an
 * operation through the entrypoint of the contract that does so, passing the
 * {@link SignedOperation} that {@link defineSignedOperation} produces.
 *
 * The bytes signed are defined by the Rust `groundhog-domain-separator`
 * crate's `SignedOp` and verified by the `groundhog-signed-op` component.
 *
 * @module
 */
export {
  defineSignedOperation,
  randomNonce,
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
  SignedOp,
  SignedOpError,
  spec as SignedOpSpec,
  type SignedOpDeclaredException,
  type SignedOpException,
  type SignedOpExecuteSignedOpArgs,
  type SignedOpExecuteSignedOpResult,
} from "../contracts/signed_op.js";
