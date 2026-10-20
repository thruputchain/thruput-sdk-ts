import schema from "./schema.json" with { type: "json" };
import { fixedFromBase58, toBase58 } from "../encoding.js";
import { fromHex0x, toHex0x } from "../actions/hex.js";
import { parseDecimal } from "../actions/decimal.js";

/** An unfamiliar variant is data, never success, absence, or retry permission. */
export class UnsupportedRpcValue {
  readonly unsupported = true;
  constructor(readonly raw: unknown) {}
}

/** Malformed known result data, with the complete original result retained. */
export class RpcDecodingError extends Error {
  constructor(
    readonly path: string,
    readonly raw: unknown,
  ) {
    super(`Invalid native RPC value at ${path}`);
    this.name = "RpcDecodingError";
  }
}

/** Invalid local input. The transport was not called; this is not retry permission. */
export class RpcRequestValidationError extends Error {
  constructor(
    readonly path: string,
    message = "Invalid native RPC request",
  ) {
    super(`${message} at ${path}`);
    this.name = "RpcRequestValidationError";
  }
}

interface Schema {
  $ref?: string;
  "x-tag"?: string;
  "x-extensible"?: boolean;
  "x-base58-bytes"?: number;
  "x-opaque-string"?: boolean;
  "x-forbidden"?: string[];
  dependencies?: Record<string, string[]>;
  const?: unknown;
  enum?: unknown[];
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  "x-integer-minimum"?: string;
  "x-integer-maximum"?: string;
}
const catalog = schema as unknown as {
  schemas: Record<string, Schema>;
  methods: Record<string, { params: Schema; result: Schema; paged: boolean }>;
  errors: Record<string, { code: number; schema: Schema }[]>;
};

export const rpcPageMethods = new Set(
  Object.entries(catalog.methods)
    .filter(([, m]) => m.paged)
    .map(([name]) => name),
);
const patterns = new Map<string, RegExp>();
function matches(pattern: string, text: string) {
  let regex = patterns.get(pattern);
  if (!regex) {
    regex = new RegExp(pattern);
    patterns.set(pattern, regex);
  }
  return regex.test(text);
}
export const rpcMethodNames = Object.freeze(Object.keys(catalog.methods));

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The codec implements only the schema forms emitted by the pinned Rust owner. */
function convert(
  s: Schema,
  value: unknown,
  encode: boolean,
  path: string,
): unknown {
  const fail = (): never => {
    throw new RpcDecodingError(path, value);
  };
  if (s.$ref) {
    const name = s.$ref.split("/").at(-1)!;
    const target = catalog.schemas[name];
    if (!target) throw new Error(`Missing generated RPC schema ${name}`);
    return convert(target, value, encode, path);
  }
  if (s["x-base58-bytes"] !== undefined) {
    if (encode) {
      if (
        !(value instanceof Uint8Array) ||
        value.length !== s["x-base58-bytes"]
      )
        return fail();
      return toBase58(value);
    }
    if (typeof value !== "string") return fail();
    try {
      const bytes = fixedFromBase58(value, s["x-base58-bytes"]);
      if (toBase58(bytes) !== value) return fail();
      return bytes;
    } catch {
      return fail();
    }
  }
  if (s.const !== undefined) return value === s.const ? value : fail();
  if (s.enum) {
    if (s.enum.includes(value)) return value;
    return fail();
  }
  const variants = s.oneOf ?? s.anyOf;
  if (variants) {
    const tag = s["x-tag"];
    if (tag) {
      if (!record(value) || typeof value[tag] !== "string") return fail();
      const variant = variants.find(
        (v) => v.properties![tag]!.const === value[tag],
      );
      if (variant) return convert(variant, value, encode, path);
      if (!encode && s["x-extensible"]) return new UnsupportedRpcValue(value);
      return fail();
    }
    for (const variant of variants) {
      try {
        return convert(variant, value, encode, path);
      } catch (error) {
        if (!(error instanceof RpcDecodingError)) throw error;
      }
    }
    if (!encode && s["x-extensible"] && typeof value === "string")
      return new UnsupportedRpcValue(value);
    return fail();
  }
  if (s["x-integer-minimum"] !== undefined) {
    const minimum = BigInt(s["x-integer-minimum"]);
    const maximum = BigInt(s["x-integer-maximum"]!);
    if (encode) {
      if (typeof value !== "bigint" || value < minimum || value > maximum)
        return fail();
      return value.toString();
    }
    try {
      return parseDecimal(value, path, minimum, maximum);
    } catch {
      return fail();
    }
  }
  if (s.type === "null") return value === null ? null : fail();
  if (s.type === "object") {
    if (!record(value) || value instanceof Uint8Array) return fail();
    const properties = s.properties ?? {};
    if (s["x-forbidden"]?.some((k) => Object.hasOwn(value, k))) return fail();
    for (const [field, required] of Object.entries(s.dependencies ?? {}))
      if (
        Object.hasOwn(value, field) &&
        required.some((k) => !Object.hasOwn(value, k))
      )
        return fail();
    for (const required of s.required ?? [])
      if (!Object.hasOwn(value, required) || value[required] === undefined)
        return fail();
    // Responses retain additive fields. Requests cannot silently ignore typos.
    if (encode && Object.keys(value).some((k) => !Object.hasOwn(properties, k)))
      return fail();
    const result: Record<string, unknown> = encode ? {} : { ...value };
    for (const [k, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, k) && value[k] !== undefined)
        result[k] = convert(child, value[k], encode, `${path}/${k}`);
    }
    return result;
  }
  if (s.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (s.minItems ?? 0) ||
      value.length > (s.maxItems ?? Infinity)
    )
      return fail();
    return value.map((v, i) => convert(s.items!, v, encode, `${path}/${i}`));
  }
  if (s.type === "integer" || s.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < (s.minimum ?? -Infinity) ||
      value > (s.maximum ?? Infinity)
    )
      return fail();
    return value;
  }
  if (s.type === "string") {
    const hex = s.pattern?.startsWith("^0x");
    const cursor = s["x-opaque-string"];
    let text = value;
    if (encode && hex && !cursor) {
      if (!(value instanceof Uint8Array)) return fail();
      text = toHex0x(value);
    }
    let length = 0;
    if (
      typeof text === "string" &&
      (s.minLength !== undefined || s.maxLength !== undefined)
    )
      for (const _ of text) length++;
    if (
      typeof text !== "string" ||
      /[\uD800-\uDFFF]/u.test(text) ||
      length < (s.minLength ?? 0) ||
      length > (s.maxLength ?? Infinity) ||
      (s.pattern && !matches(s.pattern, text))
    )
      return fail();
    return !encode && hex && !cursor ? fromHex0x(text) : text;
  }
  if (s.type === "boolean") return typeof value === "boolean" ? value : fail();
  throw new Error(`Unsupported generated RPC schema at ${path}`);
}

export function encodeRequest(
  method: string,
  value: unknown,
): Record<string, unknown> {
  const entry = catalog.methods[method];
  if (!entry) throw new Error(`Unknown native RPC method ${method}`);
  try {
    const encoded = convert(entry.params, value, true, "/params") as Record<
      string,
      unknown
    >;
    if (
      entry.paged &&
      Object.hasOwn(encoded, "start") === Object.hasOwn(encoded, "cursor")
    )
      throw new RpcDecodingError("/params", value);
    return encoded;
  } catch (error) {
    if (error instanceof RpcDecodingError)
      throw new RpcRequestValidationError(error.path);
    throw error;
  }
}

export function decodeResult(method: string, value: unknown): unknown {
  const entry = catalog.methods[method];
  if (!entry) throw new Error(`Unknown native RPC method ${method}`);
  try {
    return convert(entry.result, value, false, "/result");
  } catch (error) {
    if (error instanceof RpcDecodingError)
      throw new RpcDecodingError(error.path, value);
    throw error;
  }
}

/** Method/code membership and structural evidence; relational identity checks live in the reader. */
export function decodeErrorData(
  method: string,
  code: number,
  value: unknown,
): unknown {
  const entry = catalog.errors[method]?.find((entry) => entry.code === code);
  if (!entry) throw new RpcDecodingError("/error", value);
  return convert(entry.schema, value, false, "/error/data");
}
