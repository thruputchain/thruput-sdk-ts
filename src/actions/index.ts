/**
 * Standalone JSON-RPC actions that accept a transport as their first argument.
 *
 * Use this entrypoint when you want function-level composition instead of the
 * bound client convenience object from the root package.
 *
 * @module
 */
export * from "./public/index.js";
export * from "./wallet/index.js";
