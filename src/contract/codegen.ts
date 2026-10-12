import type { XdrCodec } from "@thruputchain/xdr";
import { Int32Codec } from "@thruputchain/protocol";
import type {
  ContractSpecId,
  ContractTypeDef,
  ContractUnionCaseType,
} from "./spec.js";
import {
  ContractTypeDefKind,
  ContractUnionCaseKind,
  formatSpecId,
  specIdKey,
} from "./spec.js";
import { resolveCodec } from "./encode.js";

/**
 * Build codecs for named contract-spec types.
 *
 * The returned map is required by {@link encodeCalldata},
 * {@link decodeCalldata}, and {@link resolveCodec} whenever a method argument
 * references a named struct, enum, or union. It is keyed by
 * {@link specIdKey} of each type's spec id.
 *
 * @throws If two definitions share a spec id.
 */
export function buildNamedCodecs(
  typeDefs: ContractTypeDef[],
): Record<string, XdrCodec<unknown>> {
  const codecs: Record<string, XdrCodec<unknown>> = Object.create(null);

  const define = (id: ContractSpecId, codec: XdrCodec<unknown>): void => {
    const key = specIdKey(id);
    if (Object.hasOwn(codecs, key)) {
      throw new Error(`Contract spec defines "${formatSpecId(id)}" twice`);
    }
    codecs[key] = codec;
  };

  for (const def of typeDefs) {
    switch (def.v) {
      case ContractTypeDefKind.TypeDefEnum:
        define(
          def.enum_def.name,
          enumCodec(
            formatSpecId(def.enum_def.name),
            def.enum_def.variants.map((variant) => variant.value),
          ),
        );
        break;

      case ContractTypeDefKind.TypeDefStruct: {
        const structDef = def.struct_def;
        const name = formatSpecId(structDef.name);
        define(structDef.name, {
          encode(w, val: unknown) {
            if (!val || typeof val !== "object" || Array.isArray(val)) {
              throw new TypeError(`Expected object for struct "${name}"`);
            }
            const obj = val as Record<string, unknown>;
            for (const field of structDef.fields) {
              const fieldCodec = resolveCodec(field.ty, codecs);
              fieldCodec.encode(
                w,
                ownProperty(obj, field.name, `Struct "${name}"`),
              );
            }
          },
          decode(r) {
            const obj: Record<string, unknown> = {};
            for (const field of structDef.fields) {
              const fieldCodec = resolveCodec(field.ty, codecs);
              defineRecordValue(obj, field.name, fieldCodec.decode(r));
            }
            return obj;
          },
        });
        break;
      }

      case ContractTypeDefKind.TypeDefUnion: {
        const unionDef = def.union_def;
        const name = formatSpecId(unionDef.name);
        define(unionDef.name, {
          encode(w, val: unknown) {
            if (!val || typeof val !== "object" || Array.isArray(val)) {
              throw new TypeError(`Expected case object for union "${name}"`);
            }
            const obj = val as { case?: unknown; value?: unknown };
            const caseName = ownProperty(obj, "case", `Union "${name}"`);
            const caseSpec = unionDef.cases.find(
              (candidate) => candidate.name === caseName,
            );
            if (!caseSpec) {
              throw new Error(
                `Unknown case ${String(caseName)} for union "${name}"`,
              );
            }
            w.writeInt32(caseSpec.discriminant);
            encodeUnionCase(
              caseSpec.case_type,
              Object.hasOwn(obj, "value") ? obj.value : undefined,
              w,
              codecs,
            );
          },
          decode(r) {
            const discriminant = r.readInt32();
            const caseSpec = unionDef.cases.find(
              (c) => c.discriminant === discriminant,
            );
            if (!caseSpec) {
              throw new Error(
                `Unknown discriminant ${discriminant} for union "${name}"`,
              );
            }
            return decodeUnionCase(
              caseSpec.case_type,
              caseSpec.name,
              r,
              codecs,
            );
          },
        });
        break;
      }

      default: {
        const _exhaustive: never = def;
        throw new Error(
          `Unsupported ContractTypeDefKind: ${(_exhaustive as ContractTypeDef).v}`,
        );
      }
    }
  }

  return codecs;
}

function enumCodec(name: string, values: bigint[]): XdrCodec<unknown> {
  const declared = new Set(values);
  return {
    encode(writer, value) {
      if (typeof value !== "bigint" || !declared.has(value)) {
        throw new Error(`Unknown value ${String(value)} for enum "${name}"`);
      }
      Int32Codec.encode(writer, value);
    },
    decode(reader) {
      const value = Int32Codec.decode(reader);
      if (!declared.has(value)) {
        throw new Error(`Unknown value ${value} for enum "${name}"`);
      }
      return value;
    },
  };
}

function encodeUnionCase(
  caseType: ContractUnionCaseType,
  value: unknown,
  w: Parameters<XdrCodec<unknown>["encode"]>[0],
  codecs: Record<string, XdrCodec<unknown>>,
): void {
  switch (caseType.v) {
    case ContractUnionCaseKind.UnionCaseVoid:
      if (value !== undefined) {
        throw new TypeError("Void union case must not contain a value");
      }
      break;
    case ContractUnionCaseKind.UnionCaseTuple: {
      if (!Array.isArray(value) || value.length !== caseType.tuple.length) {
        throw new TypeError(
          `Tuple union case expected ${caseType.tuple.length} values`,
        );
      }
      const arr = value;
      for (const [i, type] of caseType.tuple.entries()) {
        if (!Object.hasOwn(arr, i)) {
          throw new TypeError(
            `Tuple union case requires own value at index ${i}`,
          );
        }
        const c = resolveCodec(type, codecs);
        c.encode(w, arr[i]);
      }
      break;
    }
    case ContractUnionCaseKind.UnionCaseStruct: {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Struct union case requires an object value");
      }
      const fields = value as Record<string, unknown>;
      for (const field of caseType.struct_fields) {
        const c = resolveCodec(field.ty, codecs);
        c.encode(w, ownProperty(fields, field.name, "Struct union case"));
      }
      break;
    }
    default: {
      const _exhaustive: never = caseType;
      throw new Error(
        `Unsupported ContractUnionCaseKind: ${(_exhaustive as ContractUnionCaseType).v}`,
      );
    }
  }
}

function decodeUnionCase(
  caseType: ContractUnionCaseType,
  caseName: string,
  r: Parameters<XdrCodec<unknown>["decode"]>[0],
  codecs: Record<string, XdrCodec<unknown>>,
): unknown {
  switch (caseType.v) {
    case ContractUnionCaseKind.UnionCaseVoid:
      return { case: caseName };
    case ContractUnionCaseKind.UnionCaseTuple: {
      const value = caseType.tuple.map((ty) => {
        const c = resolveCodec(ty, codecs);
        return c.decode(r);
      });
      return { case: caseName, value };
    }
    case ContractUnionCaseKind.UnionCaseStruct: {
      const value: Record<string, unknown> = {};
      for (const field of caseType.struct_fields) {
        const c = resolveCodec(field.ty, codecs);
        defineRecordValue(value, field.name, c.decode(r));
      }
      return { case: caseName, value };
    }
    default: {
      const _exhaustive: never = caseType;
      throw new Error(
        `Unsupported ContractUnionCaseKind: ${(_exhaustive as ContractUnionCaseType).v}`,
      );
    }
  }
}

function ownProperty(value: object, name: string, context: string): unknown {
  if (!Object.hasOwn(value, name)) {
    throw new TypeError(`${context} requires own property "${name}"`);
  }
  return (value as Record<string, unknown>)[name];
}

function defineRecordValue(
  record: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  Object.defineProperty(record, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
