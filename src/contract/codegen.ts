import type { XdrCodec } from "@groundhogchain/xdr";
import { Uint32Codec } from "@groundhogchain/protocol";
import type { ContractTypeDef, ContractUnionCaseType } from "./spec.js";
import { ContractTypeDefKind, ContractUnionCaseKind } from "./spec.js";
import { resolveCodec } from "./encode.js";

export function buildNamedCodecs(
  typeDefs: ContractTypeDef[],
): Record<string, XdrCodec<unknown>> {
  const codecs: Record<string, XdrCodec<unknown>> = {};

  for (const def of typeDefs) {
    switch (def.v) {
      case ContractTypeDefKind.TypeDefEnum:
        codecs[def.enum_def.name] = Uint32Codec as XdrCodec<unknown>;
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
            const obj = val as { discriminant: bigint; value?: unknown };
            w.writeUint32(obj.discriminant);
            const caseSpec = unionDef.cases.find(
              (c) => c.discriminant === obj.discriminant,
            );
            if (!caseSpec) {
              throw new Error(
                `Unknown discriminant ${obj.discriminant} for union "${unionDef.name}"`,
              );
            }
            encodeUnionCase(caseSpec.case_type, obj.value, w, codecs);
          },
          decode(r) {
            const discriminant = r.readUint32();
            const caseSpec = unionDef.cases.find(
              (c) => c.discriminant === discriminant,
            );
            if (!caseSpec) {
              throw new Error(
                `Unknown discriminant ${discriminant} for union "${unionDef.name}"`,
              );
            }
            return decodeUnionCase(caseSpec.case_type, discriminant, r, codecs);
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

function encodeUnionCase(
  caseType: ContractUnionCaseType,
  value: unknown,
  w: Parameters<XdrCodec<unknown>["encode"]>[0],
  codecs: Record<string, XdrCodec<unknown>>,
): void {
  switch (caseType.v) {
    case ContractUnionCaseKind.UnionCaseVoid:
      break;
    case ContractUnionCaseKind.UnionCaseTuple: {
      const arr = value as unknown[];
      for (let i = 0; i < caseType.tuple.length; i++) {
        const c = resolveCodec(caseType.tuple[i], codecs);
        c.encode(w, arr[i]);
      }
      break;
    }
    case ContractUnionCaseKind.UnionCaseStruct: {
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
  discriminant: bigint,
  r: Parameters<XdrCodec<unknown>["decode"]>[0],
  codecs: Record<string, XdrCodec<unknown>>,
): unknown {
  switch (caseType.v) {
    case ContractUnionCaseKind.UnionCaseVoid:
      return { discriminant };
    case ContractUnionCaseKind.UnionCaseTuple: {
      const value = caseType.tuple.map((ty) => {
        const c = resolveCodec(ty, codecs);
        return c.decode(r);
      });
      return { discriminant, value };
    }
    case ContractUnionCaseKind.UnionCaseStruct: {
      const value: Record<string, unknown> = {};
      for (const field of caseType.struct_fields) {
        const c = resolveCodec(field.ty, codecs);
        value[field.name] = c.decode(r);
      }
      return { discriminant, value };
    }
    default: {
      const _exhaustive: never = caseType;
      throw new Error(
        `Unsupported ContractUnionCaseKind: ${(_exhaustive as ContractUnionCaseType).v}`,
      );
    }
  }
}
