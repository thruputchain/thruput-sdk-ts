import type { XdrCodec } from "@groundhogchain/xdr";

declare const signedTokenPreimageBrand: unique symbol;

/**
 * A signed auth token as it appears in contract arguments and return values.
 *
 * On the wire a token occupies no calldata bytes: the runtime passes its
 * handle out of band, and only contracts can mint or consume one. A client
 * therefore only ever sees a placeholder, which this type is. `TPreimage`
 * records the token's declared preimage type for documentation; no preimage
 * is ever available off chain.
 */
export interface SignedToken<TPreimage = unknown> {
  readonly kind: "signedToken";
  readonly [signedTokenPreimageBrand]?: TPreimage;
}

const SIGNED_TOKEN: SignedToken = Object.freeze({ kind: "signedToken" });

/** The placeholder standing in for a signed auth token. */
export function signedToken<TPreimage = unknown>(): SignedToken<TPreimage> {
  return SIGNED_TOKEN as SignedToken<TPreimage>;
}

/** Whether `value` is a signed-token placeholder. */
export function isSignedToken(value: unknown): value is SignedToken {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "signedToken"
  );
}

/**
 * Codec for a signed-token position: writes and reads nothing, since the
 * token's handle never travels in calldata or return data.
 */
export const SignedTokenCodec: XdrCodec<SignedToken> = {
  encode(_writer, value) {
    if (!isSignedToken(value)) {
      throw new TypeError("SignedToken expected a signed-token placeholder");
    }
  },
  decode() {
    return SIGNED_TOKEN;
  },
};
