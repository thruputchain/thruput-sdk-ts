import type { Transport } from "./types.js";

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

export class JsonRpcError extends Error {
  code: number;
  data?: unknown;
  method?: string;
  constructor(code: number, message: string, data?: unknown, method?: string) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
    this.method = method;
  }
}

export interface HttpTransportOptions {
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class HttpTransport implements Transport {
  #url: string;
  #headers?: Record<string, string>;
  #fetch: typeof fetch;
  #timeoutMs?: number;
  #nextId = 1;
  constructor(url: string, options: HttpTransportOptions = {}) {
    this.#url = url;
    this.#headers = options.headers;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs;
  }
  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const id = this.#nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? [],
    });

    const abort = this.#timeoutMs ? new AbortController() : undefined;
    const timeout = abort
      ? setTimeout(() => abort.abort(), this.#timeoutMs)
      : undefined;
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.#headers },
        body,
        signal: abort?.signal,
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const json = await response.json();
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
