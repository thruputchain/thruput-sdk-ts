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
} from "@groundhogchain/protocol";
import type { TypeRef, ContractSpec } from "./spec.js";

const BytesCodec: XdrCodec<Uint8Array> = {
  encode(w, val) {
    w.writeVarOpaque(val, 0xffffffff);
  },
  decode(r) {
    return r.readVarOpaque(0xffffffff);
  },
};

function resolveCodec(
  typeRef: TypeRef,
  namedCodecs?: Record<string, XdrCodec<unknown>>,
): XdrCodec<unknown> {
  switch (typeRef.kind) {
    case "address":
      return codec.ContractAddress as XdrCodec<unknown>;
    case "u128":
      return Uint128Codec as XdrCodec<unknown>;
    case "i128":
      return Int128Codec as XdrCodec<unknown>;
    case "u64":
      return Uint64Codec as XdrCodec<unknown>;
    case "i64":
      return Int64Codec as XdrCodec<unknown>;
    case "u32":
      return Uint32Codec as XdrCodec<unknown>;
    case "i32":
      return Int32Codec as XdrCodec<unknown>;
    case "bool":
      return BoolCodec as XdrCodec<unknown>;
    case "void":
      return VoidCodec as XdrCodec<unknown>;
    case "bytes":
      return BytesCodec as XdrCodec<unknown>;
    case "named": {
      const c = namedCodecs?.[typeRef.name];
      if (!c) {
        throw new Error(
          `No codec provided for named type "${typeRef.name}". ` +
            `Add it to spec.codecs.`,
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
    const argCodec = resolveCodec(method.args[i].ty, spec.codecs);
    argCodec.encode(w, args[i]);
  }
  return calldata(w.finish());
}
