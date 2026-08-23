/**
 * Helpers for building, serializing, deserializing, and signing transactions.
 *
 * Use this entrypoint when constructing transactions manually or when combining
 * generated contract invocations with custom signing flows.
 *
 * @module
 */
export { createInvocation, createTransaction } from "./build.js";
export {
  serializeTransaction,
  deserializeTransaction,
  serializeSignedTransaction,
  deserializeSignedTransaction,
} from "./serialize.js";
export { signTransaction } from "./sign.js";
export type { SignerEntry } from "./sign.js";
export { transactionSignaturePreimage } from "./preimage.js";
