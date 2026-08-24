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

  constructor(code: number, message: string, data?: unknown, method?: string) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
    this.method = method;
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
   * server supplies a `Retry-After` header. Defaults to 250.
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
   * Defaults to 30_000. Pass `0` to disable the timeout. Must be a
   * non-negative finite number.
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
   * `groundhog_sendRawTransaction` is never retried — a submission whose
   * outcome is unknown must not be re-sent.
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
  let body = "";
  try {
    body = (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
  } catch {
    // An unreadable body still produces a useful status-only error.
  }
  try {
    const envelope: unknown = JSON.parse(body);
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const error = (envelope as Record<string, unknown>).error;
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const rpcError = error as Record<string, unknown>;
        if (
          typeof rpcError.code === "number" &&
          typeof rpcError.message === "string"
        ) {
          return new JsonRpcError(
            rpcError.code,
            rpcError.message,
            rpcError.data,
            method,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  }

  /**
   * Send one JSON-RPC request and return the decoded `result` value.
   *
   * Transient idempotent failures are retried per the transport's retry
   * policy; `groundhog_sendRawTransaction` is always sent exactly once.
   */
  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const attempts =
      method === "groundhog_sendRawTransaction" ? 1 : this.#retryAttempts;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#attempt<T>(method, params);
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
        const backoff = this.#retryBaseDelayMs * 2 ** attempt;
        // Equal jitter unless the server asked for a specific delay.
        const delay =
          retryAfterMs > 0
            ? retryAfterMs
            : backoff / 2 + Math.random() * (backoff / 2);
        await sleep(delay);
      }
    }
  }

  /** Send a single JSON-RPC request attempt without retrying. */
  async #attempt<T>(method: string, params?: unknown[]): Promise<T> {
    const id = this.#nextId++;
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
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.#headers },
        body,
        signal,
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await errorFromHttpResponse(response, method);
    }
    const json = parseJsonPreservingLargeIntegers(await response.text());
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

    if (!Object.prototype.hasOwnProperty.call(envelope, "result")) {
      throw new Error("Invalid JSON-RPC response");
    }
    return envelope.result as T;
  }
}
