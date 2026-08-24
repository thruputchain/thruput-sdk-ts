/**
 * Error thrown when a `bigint` quantity cannot be represented exactly as a
 * JSON number.
 *
 * The Groundhog JSON-RPC wire format serializes heights and similar
 * quantities as decimal JSON numbers, which are only exact up to
 * `Number.MAX_SAFE_INTEGER`.
 */
export class UnsafeIntegerError extends RangeError {
  constructor(field: string, value: bigint) {
    super(
      `${field} ${value} cannot be serialized as a JSON number: ` +
        `must be between 0 and Number.MAX_SAFE_INTEGER`,
    );
    this.name = "UnsafeIntegerError";
  }
}

/**
 * Convert a non-negative `bigint` quantity to a JSON-safe number for request
 * serialization, throwing {@link UnsafeIntegerError} when the value cannot be
 * represented exactly.
 */
export function toJsonNumber(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnsafeIntegerError(field, value);
  }
  return Number(value);
}
