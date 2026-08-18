/**
 * Contract spec helpers for encoding calldata and building codecs.
 *
 * Generated bindings normally call these helpers for you. Use this entrypoint
 * directly when building tooling around contract specs or constructing
 * invocations without generated bindings.
 *
 * @module
 */
export { encodeCalldata, decodeCalldata, resolveCodec } from "./encode.js";
export { buildNamedCodecs } from "./codegen.js";
export { hashContract } from "./hash.js";
export * from "./spec.js";
