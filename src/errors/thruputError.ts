import { toHex0x } from "../actions/hex.js";
import type { ThruputErrorCode, ThruputErrorContext } from "./codes.js";
import type {
  TransactionFacts,
  TransactionFactsInput,
  TransactionOutcome,
  TransactionReason,
} from "./transaction.js";

/** Base URL of the error code reference. Each code has an anchor in lowercase. */
export const errorDocsBaseUrl =
  "https://docs.thruput.network/tools/typescript-sdk/errors/";

/** Options for a {@link ThruputError}. */
export interface ThruputErrorOptions<TCode extends ThruputErrorCode> {
  /** Typed context for the code. The error copies and freezes it. */
  readonly context?: ThruputErrorContext[TCode];
  readonly cause?: unknown;
  /**
   * Extra detail for `message`. When omitted, the client takes it from a
   * `ThruputError` cause only. It never copies messages from other causes,
   * because they can contain private application data.
   */
  readonly details?: string;
  /** Facts about the signed transaction. Supply them on every error after signing. */
  readonly transaction?: TransactionFactsInput;
}

/** Context is optional only for codes whose context has no required fields. */
export type ThruputErrorArgs<TCode extends ThruputErrorCode> =
  {} extends ThruputErrorContext[TCode]
    ? [options?: ThruputErrorOptions<TCode>]
    : [
        options: ThruputErrorOptions<TCode> & {
          readonly context: ThruputErrorContext[TCode];
        },
      ];

/** A {@link ThruputError} for one of the given codes, narrowable on `code`. */
export type ThruputErrorOf<TCode extends ThruputErrorCode = ThruputErrorCode> =
  { [K in TCode]: ThruputError<K> }[TCode];

/** JSON form of a {@link ThruputError}, from `toJSON()`. */
export interface SerializedThruputError {
  readonly name: "ThruputError";
  readonly code: string;
  readonly shortMessage: string;
  readonly details?: string;
  readonly context: unknown;
  readonly transaction?: {
    readonly hash: string;
    readonly outcome: TransactionOutcome;
    readonly reason: TransactionReason;
    readonly receipt?: unknown;
    readonly submission?: {
      readonly signedTransaction: string;
      readonly networkHash: string;
    };
  };
}

/**
 * The one error class of the client. Identify an error by its stable `code`
 * with {@link isThruputError}, and read typed data from `context`.
 *
 * Every error raised after a transaction is signed has `transaction` facts.
 * Use `transaction.outcome` to decide what to do: an `unknown` outcome never
 * permits a resend.
 *
 * `message` combines `shortMessage`, `details`, and a link to the code's
 * documentation. Context and transaction facts are copied and frozen when the
 * error is created.
 *
 * Custom transports throw this class too, for example
 * `new ThruputError("httpRequestFailed", message, { context, cause })`.
 *
 * @example
 * ```ts
 * try {
 *   await contract.view({ client, address });
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
  /** One line, without details or the docs link. */
  readonly shortMessage: string;
  // `declare` keeps absent optional fields from becoming own `undefined` properties.
  declare readonly details?: string;
  /** Link to the documentation for this code. */
  readonly docsUrl: string;
  readonly context: ThruputErrorContext[TCode];
  declare readonly transaction?: TransactionFacts;

  constructor(
    code: TCode,
    shortMessage: string,
    ...[options]: ThruputErrorArgs<TCode>
  ) {
    const details = options?.details ?? detailsFrom(options?.cause);
    const docsUrl = `${errorDocsBaseUrl}#${code.toLowerCase()}`;
    super(
      [shortMessage, details && `Details: ${details}`, `Docs: ${docsUrl}`]
        .filter(Boolean)
        .join("\n\n"),
      options && "cause" in options ? { cause: options.cause } : undefined,
    );
    this.code = code;
    this.shortMessage = shortMessage;
    if (details !== undefined) this.details = details;
    this.docsUrl = docsUrl;
    this.context = snapshot(
      options?.context ?? {},
    ) as ThruputErrorContext[TCode];
    if (options?.transaction)
      this.transaction = createTransactionFacts(options.transaction);
  }

  /**
   * Walk the `cause` chain, starting with this error. With a predicate, return
   * the first error that matches, or `null`. Without one, return the last cause.
   */
  walk(predicate?: (error: unknown) => boolean): unknown {
    const seen = new Set<unknown>();
    let current: unknown = this;
    while (true) {
      if (predicate?.(current)) return current;
      seen.add(current);
      const next =
        current !== null && typeof current === "object" && "cause" in current
          ? current.cause
          : undefined;
      if (next === undefined || seen.has(next))
        return predicate ? null : current;
      current = next;
    }
  }

  /**
   * Return a JSON-safe form for `postMessage` or storage. Structured clone keeps
   * only `name`, `message`, `stack`, and `cause`, so use this across message
   * boundaries and rebuild the error with {@link parseThruputError}. `cause` is
   * not included. Bytes become hex and bigints become decimal strings. Messages
   * longer than the limits of `parseThruputError` are shortened.
   */
  toJSON(): SerializedThruputError {
    return serialize(this, 0);
  }
}

/** Longest `shortMessage` and `details` in serialized form. */
export const serializedMessageLimits = { shortMessage: 1024, details: 4096 };

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function serialize(error: ThruputError, depth: number): SerializedThruputError {
  const transaction = error.transaction;
  return {
    name: "ThruputError",
    code: error.code,
    shortMessage: truncate(
      error.shortMessage,
      serializedMessageLimits.shortMessage,
    ),
    ...(error.details === undefined
      ? {}
      : {
          details: truncate(error.details, serializedMessageLimits.details),
        }),
    context: encodeJson(error.context, depth + 1),
    ...(transaction
      ? {
          transaction: {
            hash: toHex0x(transaction.hash),
            outcome: transaction.outcome,
            reason: transaction.reason,
            ...(transaction.receipt
              ? { receipt: encodeJson(transaction.receipt, depth + 1) }
              : {}),
            ...(transaction.submission
              ? {
                  submission: {
                    signedTransaction: toHex0x(
                      transaction.submission.signedTransaction,
                    ),
                    networkHash: toHex0x(transaction.submission.networkHash),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Check whether a value is a {@link ThruputError}, and optionally whether it has
 * a given code. Checks `name` and `code`, not `instanceof`, so it works across
 * realms and with more than one copy of the package. It requires an `Error`
 * object, so the plain output of `toJSON()` does not match; rebuild it with
 * {@link parseThruputError} first.
 *
 * @example
 * ```ts
 * if (isThruputError(error, "transactionFailed")) {
 *   console.log(error.transaction?.receipt);
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

function detailsFrom(cause: unknown): string | undefined {
  if (!isThruputError(cause)) return undefined;
  return cause.details ?? cause.shortMessage;
}

function createTransactionFacts(
  input: TransactionFactsInput,
): TransactionFacts {
  const hash = new Uint8Array(input.hash);
  const receipt = input.receipt && snapshot(input.receipt);
  return Object.freeze({
    get hash() {
      return hash.slice();
    },
    outcome: input.outcome,
    reason: input.reason,
    ...(receipt ? { receipt } : {}),
    ...(input.submission ? { submission: input.submission } : {}),
  }) as TransactionFacts;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Copy bytes, arrays, and plain objects, and freeze the copies. Keep other objects. */
export function snapshot<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;
  // `Buffer#slice` shares memory, so always copy into a new array.
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(snapshot(entry, seen));
    return Object.freeze(copy) as T;
  }
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value))
    defineEntry(copy, key, snapshot(entry, seen));
  return Object.freeze(copy) as T;
}

function isUnsupportedRpcValue(
  value: object,
): value is { unsupported: true; raw: unknown } {
  return "unsupported" in value && value.unsupported === true && "raw" in value;
}

/**
 * Encode a value as JSON-safe data with tagged objects: `$bytes` (hex),
 * `$bigint` (decimal), `$unsupported` (an unsupported RPC value), and `$error`.
 * Other errors keep only their name, because messages can be private. A plain
 * object whose only key is one of these tags decodes as the tagged value.
 */
export function encodeJson(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new RangeError("Error context is nested too deeply");
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol"
      ? undefined
      : value;
  }
  if (value instanceof Uint8Array) return { $bytes: toHex0x(value) };
  if (isThruputError(value)) return { $error: serialize(value, depth + 1) };
  if (value instanceof Error) return { $error: { name: value.name } };
  if (isUnsupportedRpcValue(value))
    return { $unsupported: encodeJson(value.raw, depth + 1) };
  if (Array.isArray(value))
    return value.map((entry) => encodeJson(entry, depth + 1) ?? null);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const encoded = encodeJson(entry, depth + 1);
    if (encoded !== undefined) defineEntry(result, key, encoded);
  }
  return result;
}

/** Set an own data property, so a key such as `__proto__` cannot change the prototype. */
export function defineEntry(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
