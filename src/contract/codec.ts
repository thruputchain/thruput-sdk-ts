import { CxsReader, CxsWriter, type XdrCodec } from "@groundhogchain/xdr";
import type { ContractType, ContractTypeDef } from "./spec.js";
import { buildNamedCodecs } from "./codegen.js";
import { enableResolvedCodecCache, resolveCodec } from "./encode.js";
import { ContractDecodeError } from "./errors.js";

/** Complete-input codec used by generated contract descriptors. */
export interface ContractCodec<T> {
  encode(value: T): Uint8Array;
  decode(data: Uint8Array): T;
}

declare const contractCodecContextBrand: unique symbol;

/** Opaque named-codec context shared by one generated binding module. */
export interface ContractCodecContext {
  readonly [contractCodecContextBrand]: true;
}

const contextCodecs = new WeakMap<
  ContractCodecContext,
  Record<string, XdrCodec<unknown>>
>();

/** Build the shared codec context for a generated binding module. */
export function createContractCodecContext(
  typeDefs: readonly ContractTypeDef[],
): ContractCodecContext {
  const context = Object.freeze({}) as ContractCodecContext;
  const namedCodecs = buildNamedCodecs(structuredClone([...typeDefs]));
  enableResolvedCodecCache(namedCodecs);
  contextCodecs.set(context, namedCodecs);
  return context;
}

/** @internal */
export function resolveContextCodec(
  context: ContractCodecContext,
  type: ContractType,
): XdrCodec<unknown> {
  const namedCodecs = contextCodecs.get(context);
  if (!namedCodecs) {
    throw new TypeError("Invalid ContractCodecContext");
  }
  return resolveCodec(type, namedCodecs);
}

/** @internal */
export function createContractCodec<T>(
  context: ContractCodecContext,
  type: ContractType,
  label = "contract value",
): ContractCodec<T> {
  const valueCodec = resolveContextCodec(context, type);
  return {
    encode(value) {
      const writer = new CxsWriter();
      valueCodec.encode(writer, value);
      return writer.finish();
    },
    decode(data) {
      return decodeComplete<T>(valueCodec, data, label);
    },
  };
}

/** @internal */
export function decodeComplete<T>(
  valueCodec: XdrCodec<unknown>,
  data: Uint8Array,
  label: string,
): T {
  try {
    const reader = new CxsReader(data);
    const value = valueCodec.decode(reader);
    if (reader.remaining !== 0) {
      throw new Error(`${reader.remaining} trailing bytes`);
    }
    return value as T;
  } catch (cause) {
    if (cause instanceof ContractDecodeError) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new ContractDecodeError(`Failed to decode ${label}${detail}`, {
      cause,
    });
  }
}
