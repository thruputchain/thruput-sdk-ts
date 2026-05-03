import type { XdrCodec } from "@groundhogchain/xdr";

export interface ContractSpec {
  format: string;
  interfaces: InterfaceSpec[];
  type_defs: TypeDef[];
  codecs?: Record<string, XdrCodec<unknown>>;
}

export interface InterfaceSpec {
  name: string;
  version: string;
  methods: MethodSpec[];
  throws?: ThrowSpec[];
}

export interface MethodSpec {
  name: string;
  args: ArgSpec[];
  return_type: TypeRef;
}

export interface ArgSpec {
  name: string;
  ty: TypeRef;
}

export interface ThrowSpec {
  selector: string;
  type: TypeRef;
}

export type TypeRef =
  | { kind: "address" }
  | { kind: "u128" }
  | { kind: "i128" }
  | { kind: "u64" }
  | { kind: "i64" }
  | { kind: "u32" }
  | { kind: "i32" }
  | { kind: "bool" }
  | { kind: "void" }
  | { kind: "bytes" }
  | { kind: "named"; name: string };

export type TypeDef = EnumTypeDef;

export interface EnumTypeDef {
  kind: "enum";
  name: string;
  variants: { name: string; value: number }[];
}
