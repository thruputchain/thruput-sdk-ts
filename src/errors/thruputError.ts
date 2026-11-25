import {
  transactionErrorCodes,
  type ThruputErrorCode,
  type ThruputErrorContext,
  type TransactionErrorCode,
} from "./codes.js";
import type { TransactionFacts, TransactionFactsInput } from "./transaction.js";

/**
 * Options for a {@link ThruputError}. `context` is required when the code's
 * context has required fields.
 */
export type ThruputErrorOptions<TCode extends ThruputErrorCode> = {
  readonly cause?: unknown;
  /**
   * Facts about the signed transaction. Required for each
   * {@link TransactionErrorCode}, and supplied on every error after signing.
   */
  readonly transaction?: TransactionFactsInput;
} & ({} extends ThruputErrorContext[TCode]
  ? { readonly context?: ThruputErrorContext[TCode] }
  : { readonly context: ThruputErrorContext[TCode] });

/**
 * A {@link ThruputError} for one of the given codes, narrowable on `code`.
 * `transaction` is required for each {@link TransactionErrorCode}.
 */
export type ThruputErrorOf<TCode extends ThruputErrorCode = ThruputErrorCode> =
  {
    [K in TCode]: K extends TransactionErrorCode
      ? ThruputError<K> & { readonly transaction: TransactionFacts }
      : ThruputError<K>;
  }[TCode];

/**
 * The one error class of the client. Identify an error by its stable `code`
 * with {@link isThruputError}, and read typed data from `context`.
 *
 * The transaction workflows, such as `executeAndWait` and the `sendTransaction`
 * action, add `transaction` facts to every error after signing; raw RPC methods
 * do not. Use `transaction.outcome` to decide what to do: an `unknown` outcome
 * never permits a resend.
 *
 * The client's messages never include the message of a cause from your
 * callbacks or signers; read it from `cause`. A provider wallet's error message
 * is forwarded as the message of its named code. The error freezes
 * `context` and `transaction`, and copies `transaction.hash`; other byte arrays
 * are not copied.
 *
 * Custom transports and tests can construct this class too, for example
 * `new ThruputError("httpRequestFailed", message, { context, cause })`.
 *
 * @example
 * ```ts
 * try {
 *   await ERC20.v0_1.getBalanceOf.view({
 *     client,
 *     address: tokenAddress,
 *     args: { addr: accountAddress },
 *     minStateBlockHeight: receipt.blockHeight,
 *   });
 * } catch (error) {
 *   if (isThruputError(error, "nativeRpcError") &&
 *       error.context.kind === "stateHeightUnavailable") {
 *     // Retry later.
 *   }
 *   throw error;
 * }
 * ```
 */
export class ThruputError<
  TCode extends ThruputErrorCode = ThruputErrorCode,
> extends Error {
  override readonly name = "ThruputError" as const;
  readonly code: TCode;
  readonly context: ThruputErrorContext[TCode];
  // `declare` keeps an absent field from becoming an own `undefined` property.
  declare readonly transaction?: TransactionFacts;

  constructor(
    code: TCode,
    message: string,
    // Options can be left out only when the code needs no context.
    ...[
      options = {} as ThruputErrorOptions<TCode>,
    ]: {} extends ThruputErrorContext[TCode]
      ? [options?: ThruputErrorOptions<TCode>]
      : [options: ThruputErrorOptions<TCode>]
  ) {
    if (
      !options.transaction &&
      (transactionErrorCodes as readonly string[]).includes(code)
    )
      throw new TypeError(`${code} requires transaction facts`);
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.code = code;
    this.context = Object.freeze({
      ...options.context,
    }) as ThruputErrorContext[TCode];
    // Copy the hash, the fact an app keeps to observe the transaction.
    if (options.transaction)
      this.transaction = Object.freeze({
        ...options.transaction,
        hash: new Uint8Array(options.transaction.hash),
      });
  }
}

/**
 * Check whether a value is a {@link ThruputError}, and optionally whether it has
 * a given code. Checks `name` and `code`, not `instanceof`, so it works across
 * realms and with more than one copy of the package.
 *
 * @example
 * ```ts
 * if (isThruputError(error, "transactionFailed")) {
 *   console.log(error.transaction.receipt);
 * }
 * ```
 */
export function isThruputError<
  TCode extends ThruputErrorCode = ThruputErrorCode,
>(error: unknown, code?: TCode): error is ThruputErrorOf<TCode> {
  return (
    // Error.isError would be realm-safe, but needs Node 24. Check the tag instead.
    Object.prototype.toString.call(error) === "[object Error]" &&
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ThruputError" &&
    "code" in error &&
    typeof error.code === "string" &&
    (code === undefined || error.code === code)
  );
}
