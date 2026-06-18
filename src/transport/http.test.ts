import { describe, expect, it } from "vitest";
import openrpcSpec from "../../specs/openrpc.json";
import { GroundhogRpcErrorCode, HttpTransport, JsonRpcError } from "./http.js";

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
});
