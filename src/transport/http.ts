import type { Transport } from "./types.js";

export class JsonRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

export class HttpTransport implements Transport {
  #url: string;
  #nextId = 1;
  constructor(url: string) {
    this.#url = url;
  }
  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const id = this.#nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? [],
    });
    const response = await fetch(this.#url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
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
      throw new JsonRpcError(rpcError.code, rpcError.message, rpcError.data);
    }

    if (!Object.prototype.hasOwnProperty.call(envelope, "result")) {
      throw new Error("Invalid JSON-RPC response");
    }
    return envelope.result as T;
  }
}
