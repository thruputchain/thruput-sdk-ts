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
  OptionCodec,
  VarArrayCodec,
  FixedArrayCodec,
} from "@groundhogchain/protocol";
import type { ContractType, ContractSpec } from "./spec.js";
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
    w.writeUint32(val & 0xffn);
  },
  decode(r) {
    return r.readUint32() & 0xffn;
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
        throw new Error(
          `No codec for named type "${ty.named}". ` +
            `Call buildNamedCodecs() first.`,
        );
      }
      return c;
    }
  }
}

export function encodeCalldata(
  spec: ContractSpec,
  interfaceName: string,
  methodName: string,
  args: unknown[],
  namedCodecs?: Record<string, XdrCodec<unknown>>,
): Calldata {
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
