import type { XdrCodec } from "@groundhogchain/xdr";
import { Int32Codec } from "@groundhogchain/protocol";
import type { ContractTypeDef, ContractUnionCaseType } from "./spec.js";
import { ContractTypeDefKind, ContractUnionCaseKind } from "./spec.js";
import { resolveCodec } from "./encode.js";

/**
 * Build codecs for named contract-spec types.
 *
 * The returned map is required by {@link encodeCalldata},
 * {@link decodeCalldata}, and {@link resolveCodec} whenever a method argument
 * references a named struct, enum, or union.
 */
export function buildNamedCodecs(
  typeDefs: ContractTypeDef[],
): Record<string, XdrCodec<unknown>> {
  const codecs: Record<string, XdrCodec<unknown>> = {};

  for (const def of typeDefs) {
    switch (def.v) {
      case ContractTypeDefKind.TypeDefEnum:
        codecs[def.enum_def.name] = enumCodec(
          def.enum_def.name,
          def.enum_def.variants.map((variant) => variant.value),
        );
        break;

      case ContractTypeDefKind.TypeDefStruct: {
        const structDef = def.struct_def;
        codecs[structDef.name] = {
          encode(w, val: unknown) {
            const obj = val as Record<string, unknown>;
            for (const field of structDef.fields) {
              const fieldCodec = resolveCodec(field.ty, codecs);
              fieldCodec.encode(w, obj[field.name]);
            }
          },
          decode(r) {
            const obj: Record<string, unknown> = {};
            for (const field of structDef.fields) {
              const fieldCodec = resolveCodec(field.ty, codecs);
              obj[field.name] = fieldCodec.decode(r);
            }
            return obj;
          },
        };
        break;
      }

      case ContractTypeDefKind.TypeDefUnion: {
        const unionDef = def.union_def;
        codecs[unionDef.name] = {
          encode(w, val: unknown) {
            if (!val || typeof val !== "object" || Array.isArray(val)) {
              throw new TypeError(
                `Expected case object for union "${unionDef.name}"`,
              );
            }
            const obj = val as { case?: unknown; value?: unknown };
            const caseSpec = unionDef.cases.find(
              (candidate) => candidate.name === obj.case,
            );
            if (!caseSpec) {
              throw new Error(
                `Unknown case ${String(obj.case)} for union "${unionDef.name}"`,
              );
            }
            w.writeInt32(caseSpec.discriminant);
            encodeUnionCase(caseSpec.case_type, obj.value, w, codecs);
          },
          decode(r) {
            const discriminant = r.readInt32();
            const caseSpec = unionDef.cases.find(
              (c) => c.discriminant === discriminant,
            );
            if (!caseSpec) {
              throw new Error(
                `Unknown discriminant ${discriminant} for union "${unionDef.name}"`,
              );
            }
            return decodeUnionCase(
              caseSpec.case_type,
              caseSpec.name,
              r,
              codecs,
            );
          },
        };
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
      for (let i = 0; i < caseType.tuple.length; i++) {
        const c = resolveCodec(caseType.tuple[i], codecs);
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
        c.encode(w, fields[field.name]);
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
        value[field.name] = c.decode(r);
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
