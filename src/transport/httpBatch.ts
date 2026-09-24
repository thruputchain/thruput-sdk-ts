/** Scheduling and cancellation for one transport's JSON-RPC arrays. */
interface PendingRequest {
  id: number;
  body: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onCancel?: () => void;
}

export class HttpBatch {
  #queue = new Set<PendingRequest>();
  #timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly maxSize: number,
    private readonly waitMs: number,
    private readonly send: (
      body: string,
      signal: AbortSignal,
    ) => Promise<unknown>,
  ) {}

  request(id: number, body: string, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: (value: unknown) => void, value: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        callback(value);
      };
      const entry: PendingRequest = {
        id,
        body,
        resolve: (value) => finish(resolve, value),
        reject: (reason) => finish(reject, reason),
      };
      const cancel = () => {
        this.#queue.delete(entry);
        if (this.#queue.size === 0) this.#clearTimer();
        entry.reject(signal?.reason);
        entry.onCancel?.();
      };
      if (signal?.aborted) {
        entry.reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", cancel, { once: true });
      this.#queue.add(entry);
      if (this.#queue.size >= this.maxSize) {
        void this.#flush();
      } else if (this.#timer === undefined) {
        this.#timer = setTimeout(() => void this.#flush(), this.waitMs);
      }
    });
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #flush(): Promise<void> {
    this.#clearTimer();
    const entries = [...this.#queue];
    this.#queue.clear();
    if (entries.length === 0) return;

    const controller = new AbortController();
    const active = new Set(entries);
    for (const entry of entries) {
      entry.onCancel = () => {
        active.delete(entry);
        if (active.size === 0) controller.abort();
      };
    }
    try {
      const json = await this.send(
        `[${entries.map((entry) => entry.body).join(",")}]`,
        controller.signal,
      );
      // Validate all IDs before delivering any result. Cancelled calls still
      // belong to the wire request and must be included in the response.
      const responses = batchResponses(json, entries);
      for (const entry of entries) entry.resolve(responses.get(entry.id));
    } catch (error) {
      for (const entry of entries) entry.reject(error);
    } finally {
      for (const entry of entries) entry.onCancel = undefined;
    }
  }
}

function batchResponses(
  json: unknown,
  entries: readonly PendingRequest[],
): Map<number, unknown> {
  // Servers can reject an entire array (for example, an entry-count limit)
  // with one JSON-RPC error whose ID is null.
  if (
    json !== null &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    "jsonrpc" in json &&
    json.jsonrpc === "2.0" &&
    "id" in json &&
    json.id === null &&
    "error" in json &&
    !Object.hasOwn(json, "result")
  )
    return new Map(entries.map((entry) => [entry.id, json]));

  if (!Array.isArray(json) || json.length !== entries.length)
    throw new Error(
      "Invalid JSON-RPC batch response: expected one response per request",
    );
  const expected = new Set(entries.map((entry) => entry.id));
  const responses = new Map<number, unknown>();
  for (const value of json as unknown[]) {
    const response = value as Record<string, unknown> | null;
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      response.jsonrpc !== "2.0" ||
      typeof response.id !== "number" ||
      !expected.has(response.id) ||
      responses.has(response.id) ||
      Object.hasOwn(response, "result") === Object.hasOwn(response, "error")
    )
      throw new Error(
        "Invalid JSON-RPC batch response: invalid envelope or request ID",
      );
    responses.set(response.id, response);
  }
  return responses;
}
