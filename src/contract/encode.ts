import type { Calldata } from "@groundhogchain/protocol";
import {
  FixedOpaqueCodec,
  Uint8Codec,
  VarOpaqueCodec,
  type XdrCodec,
} from "@groundhogchain/xdr";
import {
  calldata,
  codec,
  BoolCodec,
  VoidCodec,
  Uint32Codec,
  Uint64Codec,
  Int32Codec,
  Int64Codec,
  Uint128Codec,
  Int128Codec,
  CxsWriter,
  CxsReader,
  OptionCodec,
  VarArrayCodec,
  FixedArrayCodec,
} from "@groundhogchain/protocol";
import type { ContractType, ContractSpec, ContractSpecMethod } from "./spec.js";
import { ContractTypeKind } from "./spec.js";
import { ContractDecodeError } from "./errors.js";
import { fixedArray } from "./fixed.js";

const BytesCodec: XdrCodec<Uint8Array> = {
  encode(w, val) {
    w.writeVarOpaque(val, 0xffffffff);
  },
  decode(r) {
    return r.readVarOpaque(0xffffffff);
  },
};

const StringCodec: XdrCodec<string> = {
  encode(w, val) {
    assertWellFormedString(val);
    w.writeString(val, 0xffffffff);
  },
  decode(r) {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      r.readVarOpaque(0xffffffff),
    );
  },
};

const resolvedCodecCaches = new WeakMap<
  Record<string, XdrCodec<unknown>>,
  WeakMap<ContractType, XdrCodec<unknown>>
>();

/** @internal Enable identity caching for an immutable named-codec map. */
export function enableResolvedCodecCache(
  namedCodecs: Record<string, XdrCodec<unknown>>,
): void {
  resolvedCodecCaches.set(namedCodecs, new WeakMap());
}

function assertWellFormedString(value: string): void {
  if (typeof value !== "string") throw new TypeError("Expected string");
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("String contains an unpaired UTF-16 surrogate");
      }
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("String contains an unpaired UTF-16 surrogate");
    }
  }
}

function requireByteArrayCodec(
  codec: XdrCodec<Uint8Array>,
): XdrCodec<Uint8Array> {
  return {
    encode(writer, value) {
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array for U8 container");
      }
      codec.encode(writer, value);
    },
    decode: codec.decode,
  };
}

/**
 * Resolve a contract-spec type into the XDR/CXS codec used to encode values.
 *
 * Pass `namedCodecs` when resolving named structs, enums, or unions from a
 * contract spec. Build that map with {@link buildNamedCodecs}.
 */
export function resolveCodec(
  ty: ContractType,
  namedCodecs?: Record<string, XdrCodec<unknown>>,
): XdrCodec<unknown> {
  if (!namedCodecs) return resolveUncachedCodec(ty);

  const cache = resolvedCodecCaches.get(namedCodecs);
  if (!cache) return resolveUncachedCodec(ty, namedCodecs);
  const cached = cache.get(ty);
  if (cached) return cached;

  const codec = resolveUncachedCodec(ty, namedCodecs);
  cache.set(ty, codec);
  return codec;
}

function resolveUncachedCodec(
  ty: ContractType,
  namedCodecs?: Record<string, XdrCodec<unknown>>,
): XdrCodec<unknown> {
  switch (ty.v) {
    case ContractTypeKind.Address:
      return codec.ContractAddress as XdrCodec<unknown>;
    case ContractTypeKind.U128:
      return Uint128Codec as XdrCodec<unknown>;
    case ContractTypeKind.I128:
      return Int128Codec as XdrCodec<unknown>;
    case ContractTypeKind.U64:
      return Uint64Codec as XdrCodec<unknown>;
    case ContractTypeKind.I64:
      return Int64Codec as XdrCodec<unknown>;
    case ContractTypeKind.U32:
      return Uint32Codec as XdrCodec<unknown>;
    case ContractTypeKind.I32:
      return Int32Codec as XdrCodec<unknown>;
    case ContractTypeKind.U8:
      return Uint8Codec as XdrCodec<unknown>;
    case ContractTypeKind.Bool:
      return BoolCodec as XdrCodec<unknown>;
    case ContractTypeKind.Void:
      return VoidCodec as XdrCodec<unknown>;
    case ContractTypeKind.Bytes:
      return BytesCodec as XdrCodec<unknown>;
    case ContractTypeKind.String:
      return StringCodec as XdrCodec<unknown>;
    case ContractTypeKind.Option:
      return OptionCodec(
        resolveCodec(ty.option_inner!, namedCodecs),
      ) as XdrCodec<unknown>;
    case ContractTypeKind.Vector:
      if (ty.vector.element?.v === ContractTypeKind.U8) {
        return requireByteArrayCodec(
          VarOpaqueCodec(Number(ty.vector.max_len)),
        ) as XdrCodec<unknown>;
      }
      return VarArrayCodec(
        resolveCodec(ty.vector.element!, namedCodecs),
        Number(ty.vector.max_len),
      ) as XdrCodec<unknown>;
    case ContractTypeKind.Array:
      if (ty.array.element?.v === ContractTypeKind.U8) {
        return requireByteArrayCodec(
          FixedOpaqueCodec(Number(ty.array.len)),
        ) as XdrCodec<unknown>;
      }
      const arrayLength = Number(ty.array.len);
      const arrayCodec = FixedArrayCodec(
        resolveCodec(ty.array.element!, namedCodecs),
        arrayLength,
      );
      return {
        encode: arrayCodec.encode,
        decode(reader) {
          return fixedArray(arrayCodec.decode(reader), arrayLength);
        },
      } as XdrCodec<unknown>;
    case ContractTypeKind.Tuple: {
      const innerCodecs = ty.tuple.map((t) => resolveCodec(t, namedCodecs));
      return {
        encode(w, val: unknown) {
          if (!Array.isArray(val) || val.length !== innerCodecs.length) {
            throw new TypeError(
              `Tuple expected ${innerCodecs.length} values, got ${Array.isArray(val) ? val.length : "non-array"}`,
            );
          }
          const arr = val;
          for (let i = 0; i < innerCodecs.length; i++) {
            innerCodecs[i].encode(w, arr[i]);
          }
        },
        decode(r) {
          return innerCodecs.map((c) => c.decode(r));
        },
      } as XdrCodec<unknown>;
    }
    case ContractTypeKind.Named: {
      const c = namedCodecs?.[ty.named];
      if (!c) {
        throw new Error(`No codec for named type "${ty.named}".`);
      }
      return c;
    }
    case ContractTypeKind.SignedToken:
      throw new Error("SignedToken contract types are not supported yet.");
    default: {
      const _exhaustive: never = ty;
      throw new Error(
        `Unsupported ContractType kind: ${(_exhaustive as ContractType).v}`,
      );
    }
  }
}

function lookupMethod(
  spec: ContractSpec,
  interfaceName: string,
  methodName: string,
): ContractSpecMethod {
  const iface = spec.interfaces.find((i) => i.name === interfaceName);
  if (!iface) {
    throw new Error(`Interface "${interfaceName}" not found in spec`);
  }
  const method = iface.methods.find((m) => m.name === methodName);
  if (!method) {
    throw new Error(
      `Method "${methodName}" not found in interface "${interfaceName}"`,
    );
  }
  return method;
}

/**
 * Encode method arguments into contract calldata using a contract spec.
 *
 * Generated contract bindings call this helper internally. Use it directly when
 * constructing invocations from a spec without generated TypeScript bindings.
 *
 * @example
 * ```ts
 * const namedCodecs = buildNamedCodecs(spec.type_defs);
 * const calldata = encodeCalldata(
 *   spec,
 *   "Counter",
 *   "increment",
 *   [1n],
 *   namedCodecs,
 * );
 * ```
 */
export function encodeCalldata(
  spec: ContractSpec,
  interfaceName: string,
  methodName: string,
  args: unknown[],
  namedCodecs: Record<string, XdrCodec<unknown>>,
): Calldata {
  const method = lookupMethod(spec, interfaceName, methodName);

  if (args.length !== method.args.length) {
    throw new Error(
      `Expected ${method.args.length} args for "${methodName}", got ${args.length}`,
    );
  }

  const w = new CxsWriter();
  for (let i = 0; i < method.args.length; i++) {
    const argCodec = resolveCodec(method.args[i].ty, namedCodecs);
    argCodec.encode(w, args[i]);
  }
  return calldata(w.finish());
}

/**
 * Decode contract calldata into an object keyed by argument name.
 *
 * This is primarily useful for tooling, tests, and debugging generated
 * invocations.
 */
export function decodeCalldata(
  spec: ContractSpec,
  interfaceName: string,
  methodName: string,
  data: Uint8Array,
  namedCodecs: Record<string, XdrCodec<unknown>>,
): Record<string, unknown> {
  const method = lookupMethod(spec, interfaceName, methodName);

  try {
    const r = new CxsReader(data);
    const result: Record<string, unknown> = {};
    for (const arg of method.args) {
      const argCodec = resolveCodec(arg.ty, namedCodecs);
      result[arg.name] = argCodec.decode(r);
    }
    if (r.remaining !== 0) {
      throw new Error(
        `Trailing data after decoding "${methodName}": ${r.remaining} bytes remaining`,
      );
    }
    return result;
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new ContractDecodeError(
      `Failed to decode calldata for "${interfaceName}.${methodName}"${detail}`,
      { cause },
    );
  }
}
