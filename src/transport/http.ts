import type { Transport } from "./types.js";

/** JSON-RPC error codes currently returned by Groundhog gateways. */
export const GroundhogRpcErrorCode = {
  InvalidParams: -32602,
  TxInvalid: -32000,
  TxRejected: -32001,
  TxNotFound: -32002,
  BlockNotFound: -32010,
  BackendUnavailable: -32050,
  BackendTimeout: -32051,
  NotImplemented: -32052,
  Overloaded: -32053,
} as const;

/**
 * Error thrown when a JSON-RPC response contains an `error` object.
 *
 * Transport-level HTTP failures and malformed envelopes throw regular `Error`
 * instances instead.
 */
export class JsonRpcError extends Error {
  /** JSON-RPC numeric error code. */
  code: number;

  /** Optional JSON-RPC error data returned by the gateway. */
  data?: unknown;

  /** JSON-RPC method associated with the failed request, when known. */
  method?: string;

  /**
   * HTTP status of the non-2xx response that carried this error envelope.
   *
   * Absent when the envelope arrived on a 2xx response. Retriable statuses
   * (429/502/503/504) keep the transport's HTTP-level retry policy in effect
   * regardless of the embedded RPC code.
   */
  httpStatus?: number;

  /** Server-requested retry delay from `Retry-After`, in milliseconds. */
  retryAfterMs?: number;

  constructor(
    code: number,
    message: string,
    data?: unknown,
    method?: string,
    httpStatus?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
    this.method = method;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry policy for {@link HttpTransport}. */
export interface HttpTransportRetryOptions {
  /**
   * Total number of request attempts, including the first one.
   *
   * Defaults to 3.
   */
  attempts?: number;

  /**
   * Base delay for exponential backoff between attempts, in milliseconds.
   *
   * Attempt `n` waits roughly `baseDelayMs * 2 ** n` with jitter, unless the
   * server supplies a `Retry-After` header. Defaults to 250. Must be a
   * non-negative finite number no larger than `2**31 - 1`.
   */
  baseDelayMs?: number;
}

/** Options for {@link HttpTransport}. */
export interface HttpTransportOptions {
  /** Additional HTTP headers to include with each JSON-RPC request. */
  headers?: Record<string, string>;

  /** Custom `fetch` implementation, useful for tests or non-standard runtimes. */
  fetch?: typeof fetch;

  /**
   * Abort each request attempt after this many milliseconds.
   *
   * Covers the whole attempt, including response-body consumption — a
   * server that returns headers but stalls the body still times out.
   * Defaults to 30_000. Pass `0` to disable the timeout. Must be a
   * non-negative finite number no larger than `2**31 - 1` (the maximum
   * delay JavaScript timers honor without clamping).
   */
  timeoutMs?: number;

  /**
   * External abort signal combined with the per-attempt timeout.
   *
   * Aborting it cancels the in-flight request and suppresses further
   * retries.
   */
  signal?: AbortSignal;

  /**
   * Retry policy for transient failures. Enabled by default; pass `false` to
   * disable retries entirely.
   *
   * Only idempotent failures are retried: HTTP 429/502/503/504, network-level
   * fetch failures (abort/`TypeError`), and the JSON-RPC backend-transient
   * codes `BackendUnavailable`, `BackendTimeout`, and `Overloaded`.
   * Retries apply only to the known-idempotent read methods in
   * {@link IDEMPOTENT_RPC_METHODS}; any other method — notably
   * `groundhog_sendRawTransaction`, whose outcome-unknown submissions must
   * not be re-sent — is sent exactly once.
   */
  retry?: HttpTransportRetryOptions | false;
}

/** Default timeout per request attempt, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Default total attempts when retry is enabled. */
const DEFAULT_RETRY_ATTEMPTS = 3;
/** Default backoff base delay, in milliseconds. */
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
/** Upper bound applied to server-supplied `Retry-After` delays. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Largest delay JavaScript timers honor without clamping (`2**31 - 1` ms).
 *
 * Node and browsers store timer delays as signed 32-bit integers; a larger
 * `setTimeout` delay is clamped to 1 ms, which would turn an oversized
 * timeout into a near-immediate abort. Durations beyond this bound are
 * rejected at construction instead.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * JSON-RPC methods known to be idempotent and therefore safe to retry.
 *
 * Derived from the pinned OpenRPC spec (`specs/openrpc.json`): every read
 * method, i.e. everything except `groundhog_sendRawTransaction` — a
 * submission whose outcome is unknown must not be re-sent. The retry gate
 * checks membership here, so methods not in this set — future mutating
 * methods and unknown method names alike — are never retried.
 */
export const IDEMPOTENT_RPC_METHODS: ReadonlySet<string> = new Set([
  "groundhog_chainTip",
  "groundhog_getBalance",
  "groundhog_getBlockByNumber",
  "groundhog_getEvents",
  "groundhog_getStorageAt",
  "groundhog_getTransactionReceipt",
  "groundhog_getTransactionStatus",
  "groundhog_getTransactionsByAddress",
  "groundhog_pendingTransactionCount",
  "groundhog_version",
  "groundhog_view",
]);

/** HTTP statuses that are safe to retry for idempotent JSON-RPC reads. */
const RETRIABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

/** JSON-RPC error codes that indicate a transient backend condition. */
const RETRIABLE_RPC_CODES = new Set<number>([
  GroundhogRpcErrorCode.BackendUnavailable,
  GroundhogRpcErrorCode.BackendTimeout,
  GroundhogRpcErrorCode.Overloaded,
]);

/** Longest response-body prefix retained on {@link HttpTransportError}. */
const MAX_ERROR_BODY_BYTES = 2048;

/**
 * Longest error body considered for JSON-RPC envelope parsing.
 *
 * Bodies beyond this bound skip envelope detection and become
 * {@link HttpTransportError} directly; a legitimate gateway error envelope is
 * far smaller than 1 MiB.
 */
const MAX_ERROR_PARSE_BYTES = 1024 * 1024;

/**
 * Error thrown when the gateway returns a non-2xx HTTP response whose body is
 * not a JSON-RPC error envelope.
 *
 * Envelope-shaped error bodies throw {@link JsonRpcError} instead, even on
 * non-2xx statuses.
 */
export class HttpTransportError extends Error {
  /** HTTP response status code. */
  status: number;

  /** HTTP response status text. */
  statusText: string;

  /** Response body, truncated to 2 KiB. */
  body: string;

  /** JSON-RPC method associated with the failed request, when known. */
  method?: string;

  /** Server-requested retry delay from `Retry-After`, in milliseconds. */
  retryAfterMs?: number;

  constructor(
    status: number,
    statusText: string,
    body: string,
    method?: string,
    retryAfterMs?: number,
  ) {
    const detail = body === "" ? "" : `: ${body.slice(0, 200)}`;
    super(`HTTP ${status}: ${statusText}${detail}`);
    this.name = "HttpTransportError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.method = method;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Convert a non-2xx response into the error to throw: a {@link JsonRpcError}
 * when the body carries a JSON-RPC error envelope, otherwise an
 * {@link HttpTransportError} with the truncated body attached.
 */
async function errorFromHttpResponse(
  response: Response,
  method: string,
): Promise<Error> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    // An unreadable body still produces a useful status-only error.
  }
  // Only the diagnostic body retained on HttpTransportError is truncated;
  // envelope detection parses the full body (up to a sanity bound) so a
  // large but valid JSON-RPC error envelope keeps its RPC semantics.
  const body = text.slice(0, MAX_ERROR_BODY_BYTES);
  try {
    const envelope: unknown =
      text.length <= MAX_ERROR_PARSE_BYTES ? JSON.parse(text) : undefined;
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const error = (envelope as Record<string, unknown>).error;
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const rpcError = error as Record<string, unknown>;
        if (
          typeof rpcError.code === "number" &&
          typeof rpcError.message === "string"
        ) {
          // Keep the HTTP status and Retry-After on the error so the
          // retry classifier still sees the HTTP-level retry metadata.
          return new JsonRpcError(
            rpcError.code,
            rpcError.message,
            rpcError.data,
            method,
            response.status,
            parseRetryAfterMs(response.headers.get("Retry-After")),
          );
        }
      }
    }
  } catch {
    // Not JSON; fall through to the transport-level error.
  }
  return new HttpTransportError(
    response.status,
    response.statusText,
    body,
    method,
    parseRetryAfterMs(response.headers.get("Retry-After")),
  );
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to milliseconds. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

/**
 * Sleep for `ms` milliseconds, rejecting as soon as `signal` aborts.
 *
 * The abort listener is removed on either outcome so a long-lived caller
 * signal does not accumulate listeners across retries.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The abort reason of an aborted signal, or a standard `AbortError`. */
function abortError(signal?: AbortSignal): unknown {
  return (
    signal?.reason ??
    new DOMException("This operation was aborted", "AbortError")
  );
}

/**
 * Whether this runtime's `JSON.parse` reviver receives the raw source text of
 * each primitive (the TC39 "JSON.parse source access" proposal; Node >= 21 and
 * current V8/JavaScriptCore runtimes).
 */
const HAS_JSON_PARSE_SOURCE: boolean = (() => {
  let source: unknown;
  try {
    const reviver = (
      _key: string,
      value: unknown,
      context?: { source?: string },
    ): unknown => {
      source = context?.source;
      return value;
    };
    JSON.parse("0", reviver as (key: string, value: unknown) => unknown);
  } catch {
    // Fall through: treat any reviver failure as "no source access".
  }
  return source === "0";
})();

/**
 * Parse a JSON document, preserving integer literals outside the IEEE-754
 * safe-integer range as their original decimal strings.
 *
 * Spec uint64 fields (for example `BlockInfo.networkId`) are JSON numbers;
 * `JSON.parse` alone would silently round them before the action layer
 * converts to `bigint`. The `Raw*` action interfaces accept `number | string`,
 * so out-of-range values are handed through as strings. On runtimes without
 * reviver source access this falls back to plain `JSON.parse`.
 */
function parseJsonPreservingLargeIntegers(text: string): unknown {
  if (!HAS_JSON_PARSE_SOURCE) return JSON.parse(text);
  const reviver = (
    _key: string,
    value: unknown,
    context?: { source?: string },
  ): unknown => {
    if (
      typeof value === "number" &&
      !Number.isSafeInteger(value) &&
      context?.source !== undefined &&
      /^-?\d+$/.test(context.source)
    ) {
      return context.source;
    }
    return value;
  };
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
}

/**
 * Decide whether a failed attempt may be retried.
 *
 * Returns `undefined` for non-retriable failures. For retriable failures,
 * returns the server-requested delay in milliseconds (`Retry-After`), or `0`
 * when the caller should apply its own backoff.
 */
function retriableDelayMs(error: unknown): number | undefined {
  if (error instanceof HttpTransportError) {
    if (!RETRIABLE_HTTP_STATUSES.has(error.status)) return undefined;
    return error.retryAfterMs ?? 0;
  }
  if (error instanceof JsonRpcError) {
    // An envelope delivered on a retriable HTTP status is retriable
    // regardless of the embedded RPC code, and honors Retry-After.
    if (
      error.httpStatus !== undefined &&
      RETRIABLE_HTTP_STATUSES.has(error.httpStatus)
    ) {
      return error.retryAfterMs ?? 0;
    }
    return RETRIABLE_RPC_CODES.has(error.code) ? 0 : undefined;
  }
  // Network-level failures: fetch rejects with TypeError on connection
  // errors and with an AbortError DOMException on timeout.
  if (error instanceof TypeError) return 0;
  if (error instanceof Error && error.name === "AbortError") return 0;
  return undefined;
}

/**
 * JSON-RPC 2.0 transport over HTTP POST.
 *
 * `HttpTransport` handles request IDs, JSON-RPC envelopes, optional custom
 * headers, per-attempt timeout cancellation (30 seconds by default), retry of
 * transient idempotent failures, and conversion of JSON-RPC error responses
 * into {@link JsonRpcError}.
 *
 * @example
 * ```ts
 * import { HttpTransport } from "@groundhogchain/client/transport";
 *
 * const transport = new HttpTransport("http://127.0.0.1:9545", {
 *   timeoutMs: 10_000,
 * });
 *
 * const tip = await transport.request("groundhog_chainTip");
 * ```
 */
export class HttpTransport implements Transport {
  #url: string;
  #headers?: Record<string, string>;
  #fetch: typeof fetch;
  #timeoutMs: number;
  #signal?: AbortSignal;
  #retryAttempts: number;
  #retryBaseDelayMs: number;
  #nextId = 1;

  /** Create an HTTP transport for a Groundhog JSON-RPC endpoint URL. */
  constructor(url: string, options: HttpTransportOptions = {}) {
    this.#url = url;
    this.#headers = options.headers;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 0) {
      throw new RangeError(
        `HttpTransport: timeoutMs must be a non-negative finite number, got ${this.#timeoutMs}`,
      );
    }
    if (this.#timeoutMs > MAX_TIMER_DELAY_MS) {
      throw new RangeError(
        `HttpTransport: timeoutMs must be at most ${MAX_TIMER_DELAY_MS} (2**31 - 1); ` +
          `larger delays are clamped to 1 ms by JavaScript timers. ` +
          `Pass 0 to disable the timeout, got ${this.#timeoutMs}`,
      );
    }
    this.#signal = options.signal;
    if (options.retry === false) {
      this.#retryAttempts = 1;
      this.#retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS;
    } else {
      this.#retryAttempts = options.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS;
      this.#retryBaseDelayMs =
        options.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    }
    if (!Number.isInteger(this.#retryAttempts) || this.#retryAttempts < 1) {
      throw new RangeError(
        `HttpTransport: retry.attempts must be a positive integer, got ${this.#retryAttempts}`,
      );
    }
    if (
      !Number.isFinite(this.#retryBaseDelayMs) ||
      this.#retryBaseDelayMs < 0 ||
      this.#retryBaseDelayMs > MAX_TIMER_DELAY_MS
    ) {
      throw new RangeError(
        `HttpTransport: retry.baseDelayMs must be a non-negative finite number ` +
          `at most ${MAX_TIMER_DELAY_MS} (2**31 - 1), got ${this.#retryBaseDelayMs}`,
      );
    }
  }

  /**
   * Send one JSON-RPC request and return the decoded `result` value.
   *
   * Transient failures of methods in {@link IDEMPOTENT_RPC_METHODS} are
   * retried per the transport's retry policy; any other method — including
   * `groundhog_sendRawTransaction` — is always sent exactly once.
   */
  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const attempts = IDEMPOTENT_RPC_METHODS.has(method)
      ? this.#retryAttempts
      : 1;
    const id = this.#nextId++;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#attempt<T>(id, method, params);
      } catch (error) {
        const retryAfterMs = retriableDelayMs(error);
        if (
          retryAfterMs === undefined ||
          attempt >= attempts - 1 ||
          // A caller-initiated abort is a cancellation, not a transient
          // failure — never retry past it.
          this.#signal?.aborted
        ) {
          throw error;
        }
        // Cap the exponential backoff at the timer maximum so a late
        // attempt cannot overflow into a clamped 1 ms delay.
        const backoff = Math.min(
          this.#retryBaseDelayMs * 2 ** attempt,
          MAX_TIMER_DELAY_MS,
        );
        // Equal jitter unless the server asked for a specific delay.
        const delay =
          retryAfterMs > 0
            ? retryAfterMs
            : backoff / 2 + Math.random() * (backoff / 2);
        // Abort-aware: a caller abort during backoff rejects immediately
        // instead of waiting out the delay.
        await sleep(delay, this.#signal);
      }
    }
  }

  /** Send a single JSON-RPC request attempt without retrying. */
  async #attempt<T>(
    id: number,
    method: string,
    params?: unknown[],
  ): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? [],
    });

    const signals: AbortSignal[] = [];
    if (this.#signal) signals.push(this.#signal);
    const abort = this.#timeoutMs > 0 ? new AbortController() : undefined;
    if (abort) signals.push(abort.signal);
    const timeout = abort
      ? setTimeout(() => abort.abort(), this.#timeoutMs)
      : undefined;
    const signal =
      signals.length === 0
        ? undefined
        : signals.length === 1
          ? signals[0]
          : AbortSignal.any(signals);
    // The timeout stays armed until the body has been fully consumed: the
    // fetch signal also aborts in-flight body reads, so a server that
    // returns headers promptly but stalls the body still times out.
    let text: string;
    try {
      const response = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.#headers },
        body,
        signal,
      });
      if (!response.ok) {
        throw await errorFromHttpResponse(response, method);
      }
      text = await response.text();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }

    const json = parseJsonPreservingLargeIntegers(text);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new Error("Invalid JSON-RPC response");
    }

    const envelope = json as Record<string, unknown>;
    if (envelope.error !== undefined) {
      const error = envelope.error;
      if (!error || typeof error !== "object" || Array.isArray(error)) {
        throw new Error("Invalid JSON-RPC error response");
      }
      const rpcError = error as Record<string, unknown>;
      if (
        typeof rpcError.code !== "number" ||
        typeof rpcError.message !== "string"
      ) {
        throw new Error("Invalid JSON-RPC error response");
      }
      throw new JsonRpcError(
        rpcError.code,
        rpcError.message,
        rpcError.data,
        method,
      );
    }

    // Error envelopes are exempt: JSON-RPC allows a null id when the server
    // could not read the request id.
    if (envelope.id !== id) {
      throw new Error(
        `Invalid JSON-RPC response: id mismatch (expected ${id}, got ${String(
          envelope.id,
        )})`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(envelope, "result")) {
      throw new Error("Invalid JSON-RPC response");
    }
    return envelope.result as T;
  }
}
