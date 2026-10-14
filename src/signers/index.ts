/**
 * Signer interface and built-in private-key signers: Ed25519
 * ({@link PrivateKeySigner}) and ML-DSA-65 ({@link MlDsa65Signer}).
 *
 * Wallets and production key-management systems can provide their own
 * {@link Signer} implementations.
 *
 * @module
 */
export type { Signer } from "./types.js";
export { PrivateKeySigner } from "./privateKey.js";
export { MlDsa65Signer, verifyMlDsa65 } from "./mlDsa65.js";
