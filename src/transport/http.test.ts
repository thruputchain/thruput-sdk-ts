import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import openrpcSpec from "../../specs/openrpc.json";
import {
  GroundhogRpcErrorCode,
  HttpResponseError,
  HttpTransport,
  JsonRpcError,
} from "./http.js";

function documentedErrorCodes() {
  const errors = openrpcSpec.components.errors as Record<
    string,
    { code: number }
  >;
  return Object.fromEntries(
    Object.entries(errors).map(([name, error]) => [name, error.code]),
  );
}

describe("GroundhogRpcErrorCode", () => {
  it("matches specs/openrpc.json error codes", () => {
    expect(GroundhogRpcErrorCode).toEqual(documentedErrorCodes());
  });
});

describe("HttpTransport", () => {
  it("preserves cancellation supplied by a custom fetch lifecycle", async () => {
    const cause = new DOMException("superseded", "AbortError");
    const transport = new HttpTransport("https://rpc.example", {
      fetch: async () => {
        throw cause;
      },
    });
    await expect(transport.request("groundhog_networkInfo")).rejects.toBe(
      cause,
    );
  });

  it("preserves cancellation from another JavaScript realm", async () => {
    const cause: unknown = runInNewContext(
      'Object.assign(new Error("superseded"), { name: "AbortError" })',
    );
    expect(cause).not.toBeInstanceOf(Error);
    const transport = new HttpTransport("https://rpc.example", {
      fetch: async () => {
        throw cause;
      },
    });
    await expect(transport.request("groundhog_networkInfo")).rejects.toBe(
      cause,
    );
  });

  it("does not include credentials or URL secrets in request error messages", async () => {
    const cause = new TypeError("fetch failed");
    const transport = new HttpTransport(
      "https://user:secret@rpc.example/private-token?key=secret",
      {
        fetch: async () => {
          throw cause;
        },
      },
    );
    const request = transport.request("groundhog_networkInfo");
    await expect(request).rejects.toMatchObject({
      endpoint: "https://rpc.example",
      method: "groundhog_networkInfo",
      cause,
    });
    await expect(request).rejects.toThrow(
      "groundhog_networkInfo: request to https://rpc.example failed",
    );
  });
  it("binds the default fetch to the global object", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(
        Response.json({ jsonrpc: "2.0", id: 1, result: "ok" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        new HttpTransport("http://localhost").request("groundhog_version"),
      ).resolves.toBe("ok");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws a structured error for unsuccessful HTTP responses", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(null, { status: 401, statusText: "Unauthorized" });

    const request = new HttpTransport("http://localhost", {
      fetch: fetchMock,
    }).request("groundhog_version");

    await expect(request).rejects.toBeInstanceOf(HttpResponseError);
    await expect(request).rejects.toEqual(
      expect.objectContaining({
        name: "HttpResponseError",
        status: 401,
        statusText: "Unauthorized",
      }),
    );
  });

  it("sends JSON-RPC requests with custom fetch and headers", async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock: typeof fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }),
      );
    };

    const result = await new HttpTransport("http://localhost", {
      fetch: fetchMock,
      headers: { Authorization: "Bearer token" },
    }).request("groundhog_version");

    expect(result).toBe("ok");
    expect(capturedUrl).toBe("http://localhost");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "groundhog_version",
      params: [],
    });
  });

  it("includes the RPC method on JsonRpcError", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: GroundhogRpcErrorCode.BackendUnavailable,
            message: "backend unavailable",
          },
        }),
      );

    try {
      await new HttpTransport("http://localhost", { fetch: fetchMock }).request(
        "groundhog_version",
      );
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonRpcError);
      expect(error).toMatchObject({
        code: GroundhogRpcErrorCode.BackendUnavailable,
        method: "groundhog_version",
      });
    }
  });

  it("aborts requests after timeoutMs", async () => {
    const fetchMock: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });

    await expect(
      new HttpTransport("http://localhost", {
        fetch: fetchMock,
        timeoutMs: 1,
      }).request("groundhog_version"),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("forwards per-request cancellation to fetch", async () => {
    const fetchMock: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    const abort = new AbortController();
    const result = new HttpTransport("http://localhost", {
      fetch: fetchMock,
    }).request("groundhog_requestAirdrop", [], { signal: abort.signal });

    abort.abort(new Error("cancelled"));

    await expect(result).rejects.toThrow("cancelled");
  });
});
