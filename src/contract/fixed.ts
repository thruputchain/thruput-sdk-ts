declare const fixedBytesLength: unique symbol;

/** A byte array whose length has been validated at runtime. */
export type FixedBytes<N extends number> = Uint8Array & {
  readonly [fixedBytesLength]: N;
};

/** A readonly array with a statically known and runtime-validated length. */
export type FixedArray<T, N extends number> = readonly T[] & {
  readonly length: N;
};

/** Validate and brand a caller-owned mutable byte array without copying it. */
export function fixedBytes<N extends number>(
  value: Uint8Array,
  length: N,
): FixedBytes<N> {
  validateLength(value.length, length, "FixedBytes");
  return value as FixedBytes<N>;
}

/** Validate a readonly array's length and return a frozen copy. */
export function fixedArray<T, N extends number>(
  value: readonly T[],
  length: N,
): FixedArray<T, N> {
  validateLength(value.length, length, "FixedArray");
  return Object.freeze([...value]) as FixedArray<T, N>;
}

function validateLength(actual: number, expected: number, type: string): void {
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new RangeError(`${type} length must be a non-negative safe integer`);
  }
  if (actual !== expected) {
    throw new RangeError(`${type} expected length ${expected}, got ${actual}`);
  }
}
