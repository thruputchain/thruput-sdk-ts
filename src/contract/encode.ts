import type { Calldata } from "@groundhogchain/protocol";
import type { XdrCodec } from "@groundhogchain/xdr";
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
    w.writeString(val, 0xffffffff);
  },
  decode(r) {
    return r.readString(0xffffffff);
  },
};

const Uint8Codec: XdrCodec<bigint> = {
  encode(w, val) {
    if (val < 0n || val > 255n) {
      throw new Error(`U8 value out of range: ${val}`);
    }
    (w as unknown as { putByte(b: number): void }).putByte(Number(val));
  },
  decode(r) {
    return BigInt((r as unknown as { readByte(): number }).readByte());
  },
};

export function resolveCodec(
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
      return VarArrayCodec(
        resolveCodec(ty.vector.element!, namedCodecs),
        Number(ty.vector.max_len),
      ) as XdrCodec<unknown>;
    case ContractTypeKind.Array:
      return FixedArrayCodec(
        resolveCodec(ty.array.element!, namedCodecs),
        Number(ty.array.len),
      ) as XdrCodec<unknown>;
    case ContractTypeKind.Tuple: {
      const innerCodecs = ty.tuple.map((t) => resolveCodec(t, namedCodecs));
      return {
        encode(w, val: unknown) {
          const arr = val as unknown[];
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

export function decodeCalldata(
  spec: ContractSpec,
  interfaceName: string,
  methodName: string,
  data: Uint8Array,
  namedCodecs: Record<string, XdrCodec<unknown>>,
): Record<string, unknown> {
  const method = lookupMethod(spec, interfaceName, methodName);

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
}
