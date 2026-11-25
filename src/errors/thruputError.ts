import { toHex0x } from "../actions/hex.js";
import { isUnsupportedRpcValue } from "../rpc/unsupported.js";
import type {
  ThruputErrorCode,
  ThruputErrorContext,
  TransactionErrorCode,
} from "./codes.js";
import type { SubmissionEvidence } from "../transaction/submissionEvidence.js";
import type {
  TransactionFacts,
  TransactionFactsInput,
  TransactionOutcome,
  TransactionReason,
} from "./transaction.js";

/**
 * Base URL of the error code reference in the Thruput docs. Each code has an
 * anchor in lowercase.
 */
export const errorDocsBaseUrl =
  "https://www.thruput.network/docs/typescript/reference/errors/";

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
  /**
   * Link to the documentation for this code. Defaults to the client's error
   * reference. A package that adds codes sets a link to its own page.
   */
  readonly docsUrl?: string;
  /** Facts about the signed transaction. Supply them on every error after signing. */
  readonly transaction?: TransactionFactsInput;
}

/**
 * Options that a code requires: context with required fields, and facts for
 * transaction codes. For a union of codes, an option is required when any code
 * in the union requires it.
 */
export type ThruputErrorRequiredOptions<TCode extends ThruputErrorCode> = ([
  TCode extends unknown
    ? {} extends ThruputErrorContext[TCode]
      ? never
      : TCode
    : never,
] extends [never]
  ? {}
  : { readonly context: ThruputErrorContext[TCode] }) &
  ([Extract<TCode, TransactionErrorCode>] extends [never]
    ? {}
    : { readonly transaction: TransactionFactsInput });

/** Options are optional only for codes that require none of them. */
export type ThruputErrorArgs<TCode extends ThruputErrorCode> =
  {} extends ThruputErrorRequiredOptions<TCode>
    ? [options?: ThruputErrorOptions<TCode>]
    : [
        options: ThruputErrorOptions<TCode> &
          ThruputErrorRequiredOptions<TCode>,
      ];

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

/** JSON form of a {@link ThruputError}, from `toJSON()`. */
export interface SerializedThruputError {
  /** Format version. A parser accepts only the versions it knows. */
  readonly version: 1;
  readonly name: "ThruputError";
  readonly code: string;
  readonly shortMessage: string;
  readonly details?: string;
  /** Present only when the link is not the client's default for the code. */
  readonly docsUrl?: string;
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
    const docsUrl = options?.docsUrl ?? defaultDocsUrl(code);
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
   * longer than the limits of `parseThruputError` are shortened. Never throws:
   * context nested more than 64 levels deep, or in a cycle, becomes `null` at
   * that level, and so does a number that is not finite.
   */
  toJSON(): SerializedThruputError {
    return serialize(this, 0);
  }
}

/** The client's documentation link for a code. */
export function defaultDocsUrl(code: string): string {
  return `${errorDocsBaseUrl}#${code.toLowerCase()}`;
}

/** Longest `shortMessage`, `details`, and `docsUrl` in serialized form. */
export const serializedMessageLimits = Object.freeze({
  shortMessage: 1024,
  details: 4096,
  docsUrl: 2048,
});

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function serialize(error: ThruputError, depth: number): SerializedThruputError {
  const transaction = error.transaction;
  return {
    version: 1,
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
    ...(error.docsUrl === defaultDocsUrl(error.code)
      ? {}
      : { docsUrl: error.docsUrl }),
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

function detailsFrom(cause: unknown): string | undefined {
  if (!isThruputError(cause)) return undefined;
  // A cause can be forged or come from another copy, so accept only text.
  const text = cause.details ?? cause.shortMessage;
  return typeof text === "string" ? text : undefined;
}

function createTransactionFacts(
  input: TransactionFactsInput,
): TransactionFacts {
  const hash = new Uint8Array(input.hash);
  const receipt = input.receipt && snapshot(input.receipt);
  const submission = input.submission && copySubmission(input.submission);
  return Object.freeze({
    get hash() {
      return hash.slice();
    },
    outcome: input.outcome,
    reason: input.reason,
    ...(receipt ? { receipt } : {}),
    ...(submission ? { submission } : {}),
  }) as TransactionFacts;
}

/** Copy submission bytes, so later changes to the caller's arrays cannot change them. */
function copySubmission(input: SubmissionEvidence): SubmissionEvidence {
  const signedTransaction = new Uint8Array(input.signedTransaction);
  const transactionHash = new Uint8Array(input.transactionHash);
  const networkHash = new Uint8Array(input.networkHash);
  return Object.freeze({
    get signedTransaction() {
      return signedTransaction.slice();
    },
    get transactionHash() {
      return transactionHash.slice();
    },
    get networkHash() {
      return networkHash.slice();
    },
  });
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

/** Deepest nesting of serialized data, in objects and arrays. */
export const maxJsonDepth = 64;

const tag = (value: object) => Object.prototype.toString.call(value);

/**
 * Encode a value as JSON-safe data with tagged objects: `$bytes` (hex),
 * `$bigint` (decimal), `$unsupported` (an unsupported RPC value), and `$error`.
 * Other errors keep only their name, because messages can be private. A plain
 * object that looks like a tag, such as RPC data `{ "$error": "..." }`, is
 * wrapped in `$literal`. Never throws: an object or array nested deeper than
 * the limit, for example in data from a node or in a cycle, becomes `null`, and
 * so does a number that is not finite.
 */
export function encodeJson(value: unknown, depth = 0): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol"
      ? undefined
      : value;
  }
  // Tag checks, not instanceof, also match values from another realm.
  if (tag(value) === "[object Uint8Array]")
    return { $bytes: toHex0x(value as Uint8Array) };
  if (depth >= maxJsonDepth) return null;
  if (isThruputError(value)) return { $error: serialize(value, depth + 1) };
  if (value instanceof Error || tag(value) === "[object Error]")
    return { $error: { name: String((value as Error).name) } };
  if (isUnsupportedRpcValue(value))
    return { $unsupported: encodeJson(value.raw, depth + 1) };
  if (Array.isArray(value))
    return value.map((entry) => encodeJson(entry, depth + 1) ?? null);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const encoded = encodeJson(entry, depth + 1);
    if (encoded !== undefined) defineEntry(result, key, encoded);
  }
  const keys = Object.keys(result);
  return keys.length === 1 && jsonTags.includes(keys[0]!)
    ? { $literal: result }
    : result;
}

/** Keys that mark a tagged value in serialized errors. */
export const jsonTags: readonly string[] = [
  "$bytes",
  "$bigint",
  "$unsupported",
  "$error",
  "$literal",
];

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
