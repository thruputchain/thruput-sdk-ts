/**
 * Shared response-validation helpers for action-level JSON-RPC parsing.
 *
 * Each helper throws an `Error` whose message starts with
 * `Invalid <method> response: ...`, matching the existing hand-written
 * validation style in `getTransactionReceipt.ts` / `getTransactionStatus.ts`.
 */

/**
 * Require a JSON object response value, returning it with an indexable type.
 *
 * Rejects `null`, arrays, and non-object primitives.
 */
export function requireObject(
  value: unknown,
  method: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${method} response: expected object`);
  }
  return value as Record<string, unknown>;
}

/** Require a string field on a response object. */
export function requireString(
  obj: Record<string, unknown>,
  field: string,
  method: string,
): string {
  const value = obj[field];
  if (typeof value !== "string") {
    throw new Error(`Invalid ${method} response: expected string ${field}`);
  }
  return value;
}

/**
 * Require a non-negative integer field on a response object, returned as
 * `bigint`.
 *
 * Accepts JSON numbers and decimal strings — the transport hands integer
 * literals beyond `Number.MAX_SAFE_INTEGER` through as strings.
 */
export function requireUint(
  obj: Record<string, unknown>,
  field: string,
  method: string,
): bigint {
  const value = obj[field];
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === ""
  ) {
    throw new Error(`Invalid ${method} response: expected uint ${field}`);
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid ${method} response: expected uint ${field}`);
  }
  if (parsed < 0n) {
    throw new Error(`Invalid ${method} response: expected uint ${field}`);
  }
  return parsed;
}

/** Smallest value representable as a signed 32-bit integer. */
const INT32_MIN = -2_147_483_648;
/** Largest value representable as a signed 32-bit integer. */
const INT32_MAX = 2_147_483_647;

/**
 * Require a signed 32-bit integer field on a response object, returned as
 * `number`.
 *
 * Accepts JSON numbers and decimal strings (matching {@link requireUint}'s
 * transport contract) and rejects non-integers and values outside the
 * int32 range.
 */
export function requireInt32(
  obj: Record<string, unknown>,
  field: string,
  method: string,
): number {
  const value = obj[field];
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
    parsed = Number(value);
  } else {
    throw new Error(`Invalid ${method} response: expected int32 ${field}`);
  }
  if (!Number.isInteger(parsed) || parsed < INT32_MIN || parsed > INT32_MAX) {
    throw new Error(`Invalid ${method} response: expected int32 ${field}`);
  }
  return parsed;
}
