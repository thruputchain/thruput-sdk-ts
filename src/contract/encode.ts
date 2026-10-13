import type { Calldata } from "@thruputchain/protocol";
import {
  fixedArray,
  FixedOpaqueCodec,
  Uint8Codec,
  VarOpaqueCodec,
  type XdrCodec,
} from "@thruputchain/xdr";
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
  Uint256Codec,
  Int256Codec,
  CxsWriter,
  CxsReader,
  OptionCodec,
  VarArrayCodec,
  FixedArrayCodec,
} from "@thruputchain/protocol";
import type { ContractType, ContractSpec, ContractSpecMethod } from "./spec.js";
import { ContractTypeKind, formatSpecId, specIdKey } from "./spec.js";
import { ContractDecodeError } from "./errors.js";
import { SignedTokenCodec } from "./signedToken.js";

const AddressCodec = requireByteArrayCodec(
  codec.ContractAddress as XdrCodec<Uint8Array>,
  "Address",
);
const BytesCodec = requireByteArrayCodec(VarOpaqueCodec(0xffffffff), "Bytes");
const ContractBoolCodec: XdrCodec<boolean> = {
  encode(writer, value) {
    if (typeof value !== "boolean") {
      throw new TypeError("Bool expected boolean");
    }
    BoolCodec.encode(writer, value);
  },
  decode: BoolCodec.decode,
};
const ContractVoidCodec: XdrCodec<void> = {
  encode(writer, value) {
    if (value !== undefined) {
      throw new TypeError("Void expected undefined");
    }
    VoidCodec.encode(writer, value);
  },
  decode: VoidCodec.decode,
};
const ContractU128Codec = requireBigIntCodec("U128", Uint128Codec);
const ContractI128Codec = requireBigIntCodec("I128", Int128Codec);
const ContractU256Codec = requireBigIntCodec("U256", Uint256Codec);
const ContractI256Codec = requireBigIntCodec("I256", Int256Codec);
const ContractU64Codec = requireBigIntCodec("U64", Uint64Codec);
const ContractI64Codec = requireBigIntCodec("I64", Int64Codec);
const ContractU32Codec = requireBigIntCodec("U32", Uint32Codec);
const ContractI32Codec = requireBigIntCodec("I32", Int32Codec);

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

interface ResolvedCodecCache {
  cacheableTypes: WeakSet<ContractType>;
  codecs: WeakMap<ContractType, XdrCodec<unknown>>;
}

const resolvedCodecCaches = new WeakMap<
  Record<string, XdrCodec<unknown>>,
  ResolvedCodecCache
>();

/** @internal Enable identity caching for an immutable named-codec map. */
export function enableResolvedCodecCache(
  namedCodecs: Record<string, XdrCodec<unknown>>,
  cacheableTypes: Iterable<ContractType>,
): void {
  resolvedCodecCaches.set(namedCodecs, {
    cacheableTypes: new WeakSet(cacheableTypes),
    codecs: new WeakMap(),
  });
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
  label = "U8 container",
): XdrCodec<Uint8Array> {
  return {
    encode(writer, value) {
      if (!(value instanceof Uint8Array)) {
        throw new TypeError(`Expected Uint8Array for ${label}`);
      }
      codec.encode(writer, value);
    },
    decode: codec.decode,
  };
}

function requireBigIntCodec(
  label: string,
  codec: XdrCodec<bigint>,
): XdrCodec<bigint> {
  return {
    encode(writer, value) {
      if (typeof value !== "bigint") {
        throw new TypeError(`${label} expected bigint`);
      }
      codec.encode(writer, value);
    },
    decode: codec.decode,
  };
}

function requireArrayCodec<T>(codec: XdrCodec<T[]>): XdrCodec<T[]> {
  return {
    encode(writer, value) {
      if (!Array.isArray(value)) {
        throw new TypeError("Expected array");
      }
      assertOwnArrayElements(value);
      codec.encode(writer, value);
    },
    decode: codec.decode,
  };
}

// Zero-width values can occupy no input bytes. Bound their materialization
// independently of the target network's return-buffer byte limit.
const MAX_ZERO_WIDTH_VECTOR_LENGTH = 1024;

function safeVarArrayCodec<T>(
  inner: XdrCodec<T>,
  maxLength: number,
): XdrCodec<T[]> {
  const codec = VarArrayCodec(inner, maxLength);
  return {
    encode: codec.encode,
    decode(reader) {
      const length = Number(reader.readUint32());
      if (length > maxLength) {
        throw new Error(`VarArray length ${length} exceeds max ${maxLength}`);
      }
      // Non-empty values cannot outnumber the remaining bytes. Keep small
      // zero-width vectors valid without letting a length prefix create a huge array.
      if (length > reader.remaining && length > MAX_ZERO_WIDTH_VECTOR_LENGTH) {
        throw new Error(
          `VarArray length ${length} cannot be safely materialized from ${reader.remaining} remaining bytes`,
        );
      }

      const values: T[] = [];
      for (let index = 0; index < length; index++) {
        values.push(inner.decode(reader));
      }
      return values;
    },
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

  const resolvedCache = resolvedCodecCaches.get(namedCodecs);
  if (!resolvedCache?.cacheableTypes.has(ty)) {
    return resolveUncachedCodec(ty, namedCodecs);
  }
  const cached = resolvedCache.codecs.get(ty);
  if (cached) return cached;

  const codec = resolveUncachedCodec(ty, namedCodecs);
  resolvedCache.codecs.set(ty, codec);
  return codec;
}

function resolveUncachedCodec(
  ty: ContractType,
  namedCodecs?: Record<string, XdrCodec<unknown>>,
): XdrCodec<unknown> {
  switch (ty.v) {
    case ContractTypeKind.Address:
      return AddressCodec as XdrCodec<unknown>;
    case ContractTypeKind.U128:
      return ContractU128Codec as XdrCodec<unknown>;
    case ContractTypeKind.I128:
      return ContractI128Codec as XdrCodec<unknown>;
    case ContractTypeKind.U256:
      return ContractU256Codec as XdrCodec<unknown>;
    case ContractTypeKind.I256:
      return ContractI256Codec as XdrCodec<unknown>;
    case ContractTypeKind.U64:
      return ContractU64Codec as XdrCodec<unknown>;
    case ContractTypeKind.I64:
      return ContractI64Codec as XdrCodec<unknown>;
    case ContractTypeKind.U32:
      return ContractU32Codec as XdrCodec<unknown>;
    case ContractTypeKind.I32:
      return ContractI32Codec as XdrCodec<unknown>;
    case ContractTypeKind.U8:
      return Uint8Codec as XdrCodec<unknown>;
    case ContractTypeKind.Bool:
      return ContractBoolCodec as XdrCodec<unknown>;
    case ContractTypeKind.Void:
      return ContractVoidCodec as XdrCodec<unknown>;
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
      return requireArrayCodec(
        safeVarArrayCodec(
          resolveCodec(ty.vector.element!, namedCodecs),
          Number(ty.vector.max_len),
        ),
      ) as XdrCodec<unknown>;
    case ContractTypeKind.Array:
      if (ty.array.element?.v === ContractTypeKind.U8) {
        return requireByteArrayCodec(
          FixedOpaqueCodec(Number(ty.array.len)),
        ) as XdrCodec<unknown>;
      }
      const arrayLength = Number(ty.array.len);
      const arrayCodec = requireArrayCodec(
        FixedArrayCodec(
          resolveCodec(ty.array.element!, namedCodecs),
          arrayLength,
        ),
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
          assertOwnArrayElements(arr);
          for (const [i, codec] of innerCodecs.entries()) {
            codec.encode(w, arr[i]);
          }
        },
        decode(r) {
          return innerCodecs.map((c) => c.decode(r));
        },
      } as XdrCodec<unknown>;
    }
    case ContractTypeKind.Named: {
      const key = specIdKey(ty.named);
      const codec =
        namedCodecs && Object.hasOwn(namedCodecs, key)
          ? namedCodecs[key]
          : undefined;
      if (codec === undefined) {
        throw new Error(`No codec for named type "${formatSpecId(ty.named)}".`);
      }
      return codec;
    }
    case ContractTypeKind.SignedToken:
      return SignedTokenCodec as XdrCodec<unknown>;
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
  assertOwnArrayElements(args);

  const w = new CxsWriter();
  for (const [i, arg] of method.args.entries()) {
    const argCodec = resolveCodec(arg.ty, namedCodecs);
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
      defineRecordValue(result, arg.name, argCodec.decode(r));
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

function assertOwnArrayElements(value: unknown[]): void {
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`Array requires own value at index ${index}`);
    }
  }
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
