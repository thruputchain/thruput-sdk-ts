/**
 * Signer interface and built-in Ed25519 private-key signer.
 *
 * Wallets and production key-management systems can provide their own
 * {@link Signer} implementations.
 *
 * @module
 */
export type { Signer } from "./types.js";
export { PrivateKeySigner } from "./privateKey.js";
