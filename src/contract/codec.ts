import { CxsReader, CxsWriter, type XdrCodec } from "@groundhogchain/xdr";
import type { ContractType, ContractTypeDef } from "./spec.js";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  ContractUnionCaseKind,
} from "./spec.js";
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
const contextEnums = new WeakMap<
  ContractCodecContext,
  Map<string, Map<bigint, string>>
>();

/** Build the shared codec context for a generated binding module. */
export function createContractCodecContext(
  typeDefs: readonly ContractTypeDef[],
): ContractCodecContext {
  const context = Object.freeze({}) as ContractCodecContext;
  const typeDefsSnapshot = structuredClone([...typeDefs]);
  const namedCodecs = buildNamedCodecs(typeDefsSnapshot);
  enableResolvedCodecCache(namedCodecs, collectTypeNodes(typeDefsSnapshot));
  contextCodecs.set(context, namedCodecs);
  const enums = new Map<string, Map<bigint, string>>();
  for (const definition of typeDefsSnapshot) {
    if (definition.v === ContractTypeDefKind.TypeDefEnum) {
      enums.set(
        definition.enum_def.name,
        new Map(
          definition.enum_def.variants.map((variant) => [
            variant.value,
            variant.name,
          ]),
        ),
      );
    }
  }
  contextEnums.set(context, enums);
  return context;
}

/** @internal */
export function contextEnumVariant(
  context: ContractCodecContext,
  type: ContractType,
  value: unknown,
): string | undefined {
  return type.v === ContractTypeKind.Named && typeof value === "bigint"
    ? contextEnums.get(context)?.get(type.named)?.get(value)
    : undefined;
}

function collectTypeNodes(
  typeDefs: readonly ContractTypeDef[],
): Set<ContractType> {
  const types = new Set<ContractType>();
  const visit = (type: ContractType): void => {
    if (types.has(type)) return;
    types.add(type);
    switch (type.v) {
      case ContractTypeKind.Option:
        visit(type.option_inner);
        break;
      case ContractTypeKind.Vector:
        visit(type.vector.element);
        break;
      case ContractTypeKind.Tuple:
        type.tuple.forEach(visit);
        break;
      case ContractTypeKind.Array:
        visit(type.array.element);
        break;
      case ContractTypeKind.SignedToken:
        if (type.signed_token_preimage.preimage_type) {
          visit(type.signed_token_preimage.preimage_type);
        }
        break;
    }
  };

  for (const definition of typeDefs) {
    if (definition.v === ContractTypeDefKind.TypeDefStruct) {
      definition.struct_def.fields.forEach((field) => visit(field.ty));
    } else if (definition.v === ContractTypeDefKind.TypeDefUnion) {
      for (const unionCase of definition.union_def.cases) {
        if (unionCase.case_type.v === ContractUnionCaseKind.UnionCaseTuple) {
          unionCase.case_type.tuple.forEach(visit);
        } else if (
          unionCase.case_type.v === ContractUnionCaseKind.UnionCaseStruct
        ) {
          unionCase.case_type.struct_fields.forEach((field) => visit(field.ty));
        }
      }
    }
  }
  return types;
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
