/**
 * Framework-neutral wallet wire types, boundary validation, and browser discovery.
 * Import from `@thruputchain/client/provider`. Its {@link WalletAccount} is a
 * wire pubkey account, distinct from the local-signer account in the wallet subpath.
 * Validation and discovery do not establish origin permission or wallet identity.
 *
 * Provider version 2.0.0 requires unprefixed, case-sensitive base58 for every
 * address, public key, transaction hash, and network hash. Version 1 providers
 * are rejected. Reset pre-launch sessions rather than converting stored state.
 * Serialized transaction and signed-transaction XDR remain canonical 0x hex;
 * signatures inside XDR retain their binary representation.
 *
 * @see https://docs.thruput.network/tools/wallet-provider/
 * @see https://docs.thruput.network/tools/wallet-integration/
 * @module
 */
export * from "./types.js";
export * from "./validation.js";
export * from "./discovery.js";
