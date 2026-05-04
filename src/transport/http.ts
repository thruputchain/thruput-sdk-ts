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
    const json = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };
    if (json.error) {
      throw new JsonRpcError(
        json.error.code,
        json.error.message,
        json.error.data,
      );
    }
    return json.result as T;
  }
}
