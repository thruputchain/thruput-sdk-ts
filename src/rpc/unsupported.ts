/** An unfamiliar variant is data, never success, absence, or retry permission. */
export class UnsupportedRpcValue {
  readonly unsupported = true;
  constructor(readonly raw: unknown) {}
}

/**
 * Check for an {@link UnsupportedRpcValue} without `instanceof`, so a value
 * from another copy of the package, such as the CJS build, also matches.
 */
export function isUnsupportedRpcValue(
  value: unknown,
): value is UnsupportedRpcValue {
  return (
    value !== null &&
    typeof value === "object" &&
    "unsupported" in value &&
    value.unsupported === true &&
    "raw" in value
  );
}
