/** Bounds of protocol integers represented as decimal strings in public JSON. */
export const I64_MIN = -(1n << 63n);
export const I64_MAX = (1n << 63n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;
export const I128_MAX = (1n << 127n) - 1n;
export const I128_MIN = -(1n << 127n);
export const U128_MAX = (1n << 128n) - 1n;

/** Parse a canonical, range-checked decimal string. Numeric JSON is never accepted. */
export function parseDecimal(
  value: unknown,
  field: string,
  minimum: bigint,
  maximum: bigint,
): bigint {
  if (
    typeof value !== "string" ||
    value.length >
      Math.max(minimum.toString().length, maximum.toString().length) ||
    !/^(0|-?[1-9][0-9]*)(?![\s\S])/.test(value)
  ) {
    throw new Error(`Invalid ${field}: expected a canonical decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed < minimum || parsed > maximum) {
    throw new RangeError(
      `Invalid ${field}: expected an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

export function parseHeight(value: unknown, field = "height"): bigint {
  return parseDecimal(value, field, I64_MIN, I64_MAX);
}

export function parseU64(value: unknown, field: string): bigint {
  return parseDecimal(value, field, 0n, U64_MAX);
}

/** Serialize a caller-owned bigint without passing through a JavaScript number. */
export function serializeHeight(value: bigint): string {
  if (typeof value !== "bigint" || value < 0n || value > I64_MAX) {
    throw new RangeError("height must be a non-negative int64 bigint");
  }
  return value.toString();
}

export function serializeU64(value: bigint, field: string): string {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) {
    throw new RangeError(`${field} must be a uint64 bigint`);
  }
  return value.toString();
}
