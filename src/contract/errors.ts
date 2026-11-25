import { ThruputError } from "../errors/thruputError.js";

/** Contract bytes do not match their declared ABI type. */
export function contractDecodeFailed(
  message: string,
  options?: { cause?: unknown },
): ThruputError<"contractDecodeFailed"> {
  return new ThruputError("contractDecodeFailed", message, options);
}

/** Retrieved bytes or response metadata failed identity or canonical checks. */
export function contractVerificationFailed(
  message: string,
  options?: { cause?: unknown },
): ThruputError<"contractVerificationFailed"> {
  return new ThruputError("contractVerificationFailed", message, options);
}

/** Text of an error for a wrapping message. */
export function errorText(cause: unknown): string | undefined {
  return cause instanceof Error ? cause.message : undefined;
}
