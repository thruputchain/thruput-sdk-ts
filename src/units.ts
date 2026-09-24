/** Invalid decimal input to {@link parseUnits}. */
export class ParseUnitsError extends Error {
  constructor(
    readonly code: "malformed" | "precision",
    decimals: number,
  ) {
    super(
      code === "malformed"
        ? "Use a plain decimal amount"
        : `Use at most ${decimals} decimal places`,
    );
    this.name = "ParseUnitsError";
  }
}

/**
 * Convert a plain decimal string to raw units without rounding.
 *
 * Accepts a leading minus sign. Rejects whitespace, exponent notation, and
 * excess fractional digits, including zeroes. Decimals must be 0–255.
 * Token positivity and ABI bounds are separate validation steps.
 *
 * @example `parseUnits("12.05", 2)` returns `1205n`.
 */
export function parseUnits(text: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (
    typeof text !== "string" ||
    text.trim() !== text ||
    !/^-?[0-9]+(?:\.[0-9]+)?$/.test(text)
  ) {
    throw new ParseUnitsError("malformed", decimals);
  }
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  if (fraction.length > decimals)
    throw new ParseUnitsError("precision", decimals);
  const units = BigInt(whole! + fraction.padEnd(decimals, "0"));
  return negative ? -units : units;
}

/**
 * Format raw units exactly, omitting redundant fractional zeroes.
 *
 * Decimals must be 0–255. Uses no floating-point conversion or display rounding.
 * @example `formatUnits(-1205n, 2)` returns `"-12.05"`.
 */
export function formatUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (typeof value !== "bigint") throw new TypeError("value must be a bigint");
  if (decimals === 0) return value.toString();
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("decimals must be an integer between 0 and 255");
  }
}
