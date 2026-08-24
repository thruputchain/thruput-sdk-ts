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
export { deriveContractAddress } from "../derivation/contractAddress.js";
export {
  createContractCodecContext,
  type ContractCodec,
  type ContractCodecContext,
} from "./codec.js";
export { ContractDecodeError } from "./errors.js";
export {
  bytesEqual,
  defineContractEvent,
  type ContractEvent,
  type ContractEventDefinition,
  type ContractEventFieldMetadata,
  type ContractEventFilterInput,
  type ContractEventFilterValue,
  type ContractEventReceiptOptions,
  type ContractEventTopicMetadata,
  type ContractReceiptEvent,
  type DecodedContractEvent,
} from "./event.js";
export {
  ContractReceiptError,
  ContractViewError,
  defineContractMethod,
  type ContractException,
  type ContractArgumentMetadata,
  type ContractExceptionMetadata,
  type ContractMethod,
  type ContractMethodDefinition,
  type ContractReceipt,
  type ContractReceiptFailure,
  type ContractReceiptOutcome,
  type ContractView,
  type ContractViewFailure,
  type ContractViewOptions,
  type ContractViewOutcome,
  type MethodArgs,
  type UnknownContractException,
} from "./method.js";
export {
  fixedArray,
  fixedBytes,
  type FixedArray,
  type FixedBytes,
} from "./fixed.js";
export * from "./spec.js";
