/**
 * Framework-neutral wallet wire types, boundary validation, and browser discovery.
 * Import from `@thruputchain/client/provider`. Its {@link WalletAccount} is a
 * wire pubkey account, distinct from the local-signer account in the wallet subpath.
 * Validation and discovery do not establish origin permission or wallet identity.
 *
 * @see https://docs.thruput.network/tools/wallet-provider/
 * @see https://docs.thruput.network/tools/wallet-integration/
 * @module
 */
export * from "./types.js";
export * from "./validation.js";
export * from "./discovery.js";
