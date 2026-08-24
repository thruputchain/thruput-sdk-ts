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
