import type { Transport, TransportRequestOptions } from "./types.js";
import { HttpBatch } from "./httpBatch.js";

/** JSON-RPC error codes currently returned by Groundhog gateways. */
export const GroundhogRpcErrorCode = {
  InvalidParams: -32602,
  TxInvalid: -32000,
  TxRejected: -32001,
  TxNotFound: -32002,
  LocalFundingUnresolved: -32003,
  BlockNotFound: -32010,
  BackendUnavailable: -32050,
  BackendTimeout: -32051,
  NotImplemented: -32052,
  Overloaded: -32053,
} as const;

/**
 * Error thrown when a JSON-RPC response contains an `error` object.
 *
 * Malformed envelopes throw regular `Error` instances instead.
 */
export class JsonRpcError extends Error {
  /** JSON-RPC numeric error code. */
  code: number;

  /** Optional JSON-RPC error data returned by the gateway. */
  data?: unknown;

  /** JSON-RPC method associated with the failed request, when known. */
  method?: string;

  constructor(code: number, message: string, data?: unknown, method?: string) {
    super(`${method ? `${method}: ` : ""}${message} (RPC ${code})`);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
    this.method = method;
  }
}

/** Error thrown when an HTTP response has a non-successful status. */
export class HttpResponseError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(
    status: number,
    statusText: string,
    readonly endpoint?: string,
    readonly method?: string,
  ) {
    super(
      `HTTP ${status}: ${statusText}${method ? ` (${method} at ${endpoint})` : ""}`,
    );
    this.name = "HttpResponseError";
    this.status = status;
    this.statusText = statusText;
  }
}

/** Network failure with sanitized endpoint and method context. */
export class HttpRequestError extends TypeError {
  constructor(
    readonly endpoint: string,
    readonly method: string,
    cause: unknown,
  ) {
    super(`${method}: request to ${endpoint} failed`, { cause });
    this.name = "HttpRequestError";
  }
}

/** Limits for opt-in HTTP JSON-RPC batching. */
export interface HttpBatchOptions {
  /** Maximum calls per HTTP request (1–1,000). Defaults to 100. Full batches send immediately. */
  maxSize?: number;
  /** Scheduling window in milliseconds (0–2,147,483,647). Defaults to a zero-delay timer. */
  waitMs?: number;
}

/** Options for {@link HttpTransport}. */
export interface HttpTransportOptions {
  /** Additional HTTP headers to include with each JSON-RPC request. */
  headers?: Record<string, string>;

  /** Custom `fetch` implementation, useful for tests or non-standard runtimes. */
  fetch?: typeof fetch;

  /** Abort the request, including response-body reading, with a TimeoutError after this many milliseconds. */
  timeoutMs?: number;

  /**
   * Group concurrent calls into JSON-RPC arrays. Disabled by default.
   * `true` uses 100 calls and a zero-delay scheduling window.
   *
   * Requires an endpoint that accepts JSON-RPC arrays. Even one queued call
   * is sent as an array. Responses are matched by ID, not response order.
   * RPC errors reject their own calls; HTTP failures affect the whole batch.
   * No retries or fallback requests are made, including for submissions.
   *
   * Batching provides no shared snapshot, execution order, or atomicity.
   * Await dependent calls separately. Slow calls can delay other results.
   * Cancelling one call rejects it without cancelling its peers; cancelling
   * every call aborts the HTTP request. Cancellation cannot undo submitted work.
   * `timeoutMs` starts at dispatch and covers reading the response body;
   * the scheduling window is additional to that timeout.
   */
  batch?: boolean | HttpBatchOptions;
}

/**
 * JSON-RPC 2.0 transport over HTTP POST.
 *
 * `HttpTransport` handles request IDs, JSON-RPC envelopes, optional custom
 * headers, optional timeout cancellation, and conversion of JSON-RPC error
 * responses into {@link JsonRpcError}.
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
  #timeoutMs?: number;
  #nextId = 1;
  #batch?: HttpBatch;

  /** Create an HTTP transport for a Groundhog JSON-RPC endpoint URL. */
  constructor(url: string, options: HttpTransportOptions = {}) {
    this.#url = url;
    this.#headers = options.headers;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs;
    if (options.batch) {
      const batch = options.batch === true ? {} : options.batch;
      const maxSize = batch.maxSize ?? 100;
      const waitMs = batch.waitMs ?? 0;
      if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > 1_000)
        throw new RangeError("batch.maxSize must be an integer from 1 to 1000");
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 2_147_483_647)
        throw new RangeError(
          "batch.waitMs must be an integer from 0 to 2147483647",
        );
      this.#batch = new HttpBatch(maxSize, waitMs, (body, signal) =>
        this.#post(body, "batch", { signal }),
      );
    }
  }

  /** Send one JSON-RPC request and return the decoded `result` value. */
  async request<T = unknown>(
    method: string,
    params?: unknown[],
    options: TransportRequestOptions = {},
  ): Promise<T> {
    options.signal?.throwIfAborted();
    const id = this.#nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? [],
    });

    let json: unknown;
    if (this.#batch) {
      try {
        json = await this.#batch.request(id, body, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        // Keep the original method on shared HTTP failures for each caller.
        if (error instanceof HttpRequestError)
          throw new HttpRequestError(error.endpoint, method, error.cause);
        if (error instanceof HttpResponseError)
          throw new HttpResponseError(
            error.status,
            error.statusText,
            error.endpoint,
            method,
          );
        throw error;
      }
    } else {
      json = await this.#post(body, method, options);
    }
    return decodeResponse(json, method) as T;
  }

  async #post(
    body: string,
    method: string,
    options: TransportRequestOptions,
  ): Promise<unknown> {
    const abort = this.#timeoutMs ? new AbortController() : undefined;
    const signal =
      abort && options.signal
        ? AbortSignal.any([abort.signal, options.signal])
        : (abort?.signal ?? options.signal);
    const timeout = abort
      ? setTimeout(
          () =>
            abort.abort(new DOMException("Request timed out", "TimeoutError")),
          this.#timeoutMs,
        )
      : undefined;
    let json: unknown;
    try {
      let response: Response;
      try {
        response = await this.#fetch(this.#url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.#headers },
          body,
          signal,
        });
      } catch (cause) {
        // A custom fetch may compose its own lifecycle signal outside this transport.
        if (
          typeof cause === "object" &&
          cause !== null &&
          "name" in cause &&
          (cause.name === "AbortError" || cause.name === "TimeoutError")
        )
          throw cause;
        throw new HttpRequestError(new URL(this.#url).origin, method, cause);
      }

      if (!response.ok) {
        throw new HttpResponseError(
          response.status,
          response.statusText,
          new URL(this.#url).origin,
          method,
        );
      }
      try {
        json = await response.json();
      } catch (cause) {
        // Fetch reports interrupted body reads as TypeError; JSON syntax errors
        // must retain their original type and must not trigger retries.
        if (
          typeof cause === "object" &&
          cause !== null &&
          "name" in cause &&
          cause.name === "TypeError"
        )
          throw new HttpRequestError(new URL(this.#url).origin, method, cause);
        throw cause;
      }
    } catch (cause) {
      // Body reads can reject with AbortError rather than the supplied reason.
      if (signal?.aborted) throw signal.reason;
      throw cause;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }

    return json;
  }
}

function decodeResponse(json: unknown, method: string): unknown {
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
  return envelope.result;
}
