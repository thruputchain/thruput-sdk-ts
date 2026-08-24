import { describe, expect, it, vi } from "vitest";
import openrpcSpec from "../../specs/openrpc.json";
import { getBlockByNumber } from "../actions/public/getBlockByNumber.js";
import {
  GroundhogRpcErrorCode,
  HttpTransport,
  HttpTransportError,
  IDEMPOTENT_RPC_METHODS,
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

describe("IDEMPOTENT_RPC_METHODS", () => {
  it("matches the specs/openrpc.json read methods", () => {
    const specMethods = (openrpcSpec.methods as { name: string }[]).map(
      (method) => method.name,
    );
    const readMethods = specMethods.filter(
      (name) => name !== "groundhog_sendRawTransaction",
    );
    expect([...IDEMPOTENT_RPC_METHODS].sort()).toEqual(readMethods.sort());
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

  it("preserves integer literals beyond Number.MAX_SAFE_INTEGER as strings", async () => {
    const uint64Max = 2n ** 64n - 1n;
    const fetchMock: typeof fetch = async () =>
      new Response(
        `{"jsonrpc":"2.0","id":1,"result":{"networkId":${uint64Max},"small":7,"float":2.5,"negative":-${uint64Max}}}`,
      );

    const result = await new HttpTransport("http://localhost", {
      fetch: fetchMock,
    }).request<Record<string, unknown>>("groundhog_getBlockByNumber", [0]);

    expect(result.networkId).toBe(uint64Max.toString());
    expect(BigInt(result.networkId as string)).toBe(uint64Max);
    // In-range integers and non-integer literals stay plain numbers.
    expect(result.small).toBe(7);
    expect(result.float).toBe(2.5);
    expect(result.negative).toBe(`-${uint64Max}`);
  });

  it("expands exponent-form integer literals beyond the safe range to decimal strings", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        `{"jsonrpc":"2.0","id":1,"result":{` +
          `"plain":1e21,"fractionMantissa":1.5E+21,"negative":-2e21,` +
          `"trailingZeros":9007199254740993000e-3,` +
          `"float":1e-3,"safe":1.5e1,"oversized":1e400}}`,
      );

    const result = await new HttpTransport("http://localhost", {
      fetch: fetchMock,
    }).request<Record<string, unknown>>("groundhog_getBlockByNumber", [0]);

    expect(result.plain).toBe("1" + "0".repeat(21));
    expect(BigInt(result.plain as string)).toBe(10n ** 21n);
    expect(result.fractionMantissa).toBe("15" + "0".repeat(20));
    expect(result.negative).toBe("-2" + "0".repeat(21));
    // A negative exponent that only strips trailing zeros still denotes
    // an integer; 2**53 + 1 would otherwise round.
    expect(result.trailingZeros).toBe("9007199254740993");
    // Non-integers and safe integers stay plain numbers.
    expect(result.float).toBe(1e-3);
    expect(result.safe).toBe(15);
    // Beyond the expansion bound the (overflowed) number is kept as-is.
    expect(result.oversized).toBe(Number.POSITIVE_INFINITY);
  });

  it("delivers uint64-max networkId to getBlockByNumber unchanged", async () => {
    const uint64Max = 2n ** 64n - 1n;
    const hash = "0x" + "00".repeat(32);
    const dbHash = "0x" + "00".repeat(2048);
    const fetchMock: typeof fetch = async () =>
      new Response(
        `{"jsonrpc":"2.0","id":1,"result":{"networkId":${uint64Max},"blockHeight":1,` +
          `"txsetHash":"${hash}","dbHash":"${dbHash}","eventsHash":"${hash}","prevBlockHash":"${hash}"}}`,
      );

    const block = await getBlockByNumber(
      new HttpTransport("http://localhost", { fetch: fetchMock }),
      1n,
    );

    expect(block?.networkId).toBe(uint64Max);
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
        retry: false,
      }).request("groundhog_version"),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("times out when the response body stalls after headers arrive", async () => {
    vi.useFakeTimers();
    try {
      // Headers arrive immediately, but the body stream never produces a
      // chunk. Real fetch implementations abort in-flight body reads when
      // the request signal fires, which the mock mirrors by erroring the
      // stream on abort.
      const fetchMock: typeof fetch = async (_url, init) => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stalled = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        });
        return new Response(stalled, { status: 200 });
      };

      const pending = new HttpTransport("http://localhost", {
        fetch: fetchMock,
        timeoutMs: 1_000,
        retry: false,
      }).request("groundhog_version");
      const outcome = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a 30s default timeout when timeoutMs is omitted", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock: typeof fetch = async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });

      const pending = new HttpTransport("http://localhost", {
        fetch: fetchMock,
        retry: false,
      }).request("groundhog_version");
      const outcome = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects success envelopes whose id does not match the request", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: "ok" }));

    await expect(
      new HttpTransport("http://localhost", { fetch: fetchMock }).request(
        "groundhog_version",
      ),
    ).rejects.toThrow("id mismatch");
  });

  it("rejects negative or non-finite timeoutMs", () => {
    for (const timeoutMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => new HttpTransport("http://localhost", { timeoutMs }),
      ).toThrow(RangeError);
    }
  });

  it("rejects timeoutMs beyond the 2**31 - 1 timer maximum", () => {
    // Node clamps setTimeout delays above 2**31 - 1 to 1 ms, which would
    // abort requests almost immediately instead of later.
    expect(
      () => new HttpTransport("http://localhost", { timeoutMs: 2 ** 31 }),
    ).toThrow(RangeError);
    expect(
      () => new HttpTransport("http://localhost", { timeoutMs: 2 ** 31 - 1 }),
    ).not.toThrow();
  });

  it("rejects negative, non-finite, or oversized retry.baseDelayMs", () => {
    for (const baseDelayMs of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 31,
    ]) {
      expect(
        () => new HttpTransport("http://localhost", { retry: { baseDelayMs } }),
      ).toThrow(RangeError);
    }
    expect(
      () =>
        new HttpTransport("http://localhost", {
          retry: { baseDelayMs: 2 ** 31 - 1 },
        }),
    ).not.toThrow();
  });

  it("disables the timeout when timeoutMs is 0", async () => {
    vi.useFakeTimers();
    try {
      let resolveFetch: ((response: Response) => void) | undefined;
      let aborted = false;
      const fetchMock: typeof fetch = async (_url, init) =>
        new Promise((resolve) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
          });
          resolveFetch = resolve;
        });

      const pending = new HttpTransport("http://localhost", {
        fetch: fetchMock,
        timeoutMs: 0,
        retry: false,
      }).request("groundhog_version");

      await vi.advanceTimersByTimeAsync(120_000);
      expect(aborted).toBe(false);
      resolveFetch!(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" })),
      );
      await expect(pending).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts via an external AbortSignal without retrying", async () => {
    let calls = 0;
    const controller = new AbortController();
    const fetchMock: typeof fetch = async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
        queueMicrotask(() => controller.abort());
      });
    };

    await expect(
      new HttpTransport("http://localhost", {
        fetch: fetchMock,
        signal: controller.signal,
        retry: { baseDelayMs: 1 },
      }).request("groundhog_chainTip"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  describe("non-2xx responses", () => {
    it("throws HttpTransportError carrying status, statusText, body, method", async () => {
      const fetchMock: typeof fetch = async () =>
        new Response("upstream exploded", {
          status: 500,
          statusText: "Internal Server Error",
        });

      try {
        await new HttpTransport("http://localhost", {
          fetch: fetchMock,
        }).request("groundhog_chainTip");
        throw new Error("expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpTransportError);
        expect(error).toMatchObject({
          status: 500,
          statusText: "Internal Server Error",
          body: "upstream exploded",
          method: "groundhog_chainTip",
        });
        expect((error as Error).message).toContain("HTTP 500");
        expect((error as Error).message).toContain("upstream exploded");
      }
    });

    it("truncates the retained body to 2 KiB", async () => {
      const fetchMock: typeof fetch = async () =>
        new Response("x".repeat(10_000), {
          status: 500,
          statusText: "Internal Server Error",
        });

      await expect(
        new HttpTransport("http://localhost", { fetch: fetchMock }).request(
          "groundhog_chainTip",
        ),
      ).rejects.toMatchObject({ body: "x".repeat(2048) });
    });

    it("throws JsonRpcError for an envelope error body larger than 2 KiB", async () => {
      const largeData = "x".repeat(8_192);
      const fetchMock: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: GroundhogRpcErrorCode.TxInvalid,
              message: "tx invalid",
              data: largeData,
            },
          }),
          { status: 400, statusText: "Bad Request" },
        );

      try {
        await new HttpTransport("http://localhost", {
          fetch: fetchMock,
        }).request("groundhog_chainTip");
        throw new Error("expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        expect(error).toMatchObject({
          code: GroundhogRpcErrorCode.TxInvalid,
          message: "tx invalid",
          data: largeData,
          httpStatus: 400,
        });
      }
    });

    it("throws JsonRpcError when the error body is a JSON-RPC envelope", async () => {
      const fetchMock: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: GroundhogRpcErrorCode.TxInvalid,
              message: "tx invalid",
            },
          }),
          { status: 400, statusText: "Bad Request" },
        );

      try {
        await new HttpTransport("http://localhost", {
          fetch: fetchMock,
        }).request("groundhog_chainTip");
        throw new Error("expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        expect(error).toMatchObject({
          code: GroundhogRpcErrorCode.TxInvalid,
          method: "groundhog_chainTip",
        });
      }
    });
  });

  describe("retry", () => {
    const ok = () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));

    it("retries HTTP 503 and succeeds", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        if (calls === 1) {
          return new Response("unavailable", {
            status: 503,
            statusText: "Service Unavailable",
          });
        }
        return ok();
      };

      const result = await new HttpTransport("http://localhost", {
        fetch: fetchMock,
        retry: { baseDelayMs: 1 },
      }).request("groundhog_chainTip");

      expect(result).toBe("ok");
      expect(calls).toBe(2);
    });

    it("gives up after the configured number of attempts", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        return new Response("unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        });
      };

      await expect(
        new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: { attempts: 2, baseDelayMs: 1 },
        }).request("groundhog_chainTip"),
      ).rejects.toThrow("HTTP 503");
      expect(calls).toBe(2);
    });

    it("honors Retry-After delta-seconds on 429", async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        const fetchMock: typeof fetch = async () => {
          calls++;
          if (calls === 1) {
            return new Response("slow down", {
              status: 429,
              statusText: "Too Many Requests",
              headers: { "Retry-After": "2" },
            });
          }
          return ok();
        };

        const pending = new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: { baseDelayMs: 1 },
        }).request("groundhog_chainTip");
        // The retry waits the server-requested 2s, not the 1ms backoff.
        await vi.advanceTimersByTimeAsync(1_999);
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe("ok");
        expect(calls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("retries transient JSON-RPC backend errors", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        if (calls === 1) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: {
                code: GroundhogRpcErrorCode.BackendUnavailable,
                message: "backend unavailable",
              },
            }),
          );
        }
        return ok();
      };

      const result = await new HttpTransport("http://localhost", {
        fetch: fetchMock,
        retry: { baseDelayMs: 1 },
      }).request("groundhog_chainTip");

      expect(result).toBe("ok");
      expect(calls).toBe(2);
    });

    it("does not retry non-transient JSON-RPC errors", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: GroundhogRpcErrorCode.TxInvalid,
              message: "tx invalid",
            },
          }),
        );
      };

      await expect(
        new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: { baseDelayMs: 1 },
        }).request("groundhog_chainTip"),
      ).rejects.toBeInstanceOf(JsonRpcError);
      expect(calls).toBe(1);
    });

    it("retries network-level fetch failures", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return ok();
      };

      const result = await new HttpTransport("http://localhost", {
        fetch: fetchMock,
        retry: { baseDelayMs: 1 },
      }).request("groundhog_chainTip");

      expect(result).toBe("ok");
      expect(calls).toBe(2);
    });

    it("never retries groundhog_sendRawTransaction", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        return new Response("unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        });
      };

      await expect(
        new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: { baseDelayMs: 1 },
        }).request("groundhog_sendRawTransaction", ["0x00"]),
      ).rejects.toThrow("HTTP 503");
      expect(calls).toBe(1);
    });

    it("never retries methods outside the idempotent allowlist", async () => {
      for (const method of [
        "groundhog_futureMutatingMethod",
        "unknown_method",
      ]) {
        let calls = 0;
        const fetchMock: typeof fetch = async () => {
          calls++;
          return new Response("unavailable", {
            status: 503,
            statusText: "Service Unavailable",
          });
        };

        await expect(
          new HttpTransport("http://localhost", {
            fetch: fetchMock,
            retry: { baseDelayMs: 1 },
          }).request(method),
        ).rejects.toThrow("HTTP 503");
        expect(calls).toBe(1);
      }
    });

    it("retries a 429 whose body is a non-transient JSON-RPC envelope, honoring Retry-After", async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        const fetchMock: typeof fetch = async () => {
          calls++;
          if (calls === 1) {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                error: {
                  code: GroundhogRpcErrorCode.TxInvalid,
                  message: "tx invalid",
                },
              }),
              {
                status: 429,
                statusText: "Too Many Requests",
                headers: { "Retry-After": "2" },
              },
            );
          }
          return ok();
        };

        const pending = new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: { baseDelayMs: 1 },
        }).request("groundhog_chainTip");
        // The HTTP 429 governs retriability and the retry waits the
        // server-requested 2s, even though the embedded RPC code is
        // non-transient.
        await vi.advanceTimersByTimeAsync(1_999);
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe("ok");
        expect(calls).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not retry a non-transient JSON-RPC envelope on a non-retriable HTTP status", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: GroundhogRpcErrorCode.TxInvalid,
              message: "tx invalid",
            },
          }),
          { status: 400, statusText: "Bad Request" },
        );
      };

      try {
        await new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: { baseDelayMs: 1 },
        }).request("groundhog_chainTip");
        throw new Error("expected request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(JsonRpcError);
        expect(error).toMatchObject({
          code: GroundhogRpcErrorCode.TxInvalid,
          httpStatus: 400,
        });
      }
      expect(calls).toBe(1);
    });

    it("rejects promptly when aborted during a retry backoff delay", async () => {
      const controller = new AbortController();
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        return new Response("slow down", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Retry-After": "60" },
        });
      };

      const pending = new HttpTransport("http://localhost", {
        fetch: fetchMock,
        signal: controller.signal,
        retry: { baseDelayMs: 1 },
      }).request("groundhog_chainTip");
      // Surface the rejection handler before the abort so the promise is
      // never observed as unhandled.
      const outcome = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });

      // Let the first attempt fail and the transport enter its 60s
      // Retry-After backoff sleep, then abort.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(1);
      const abortedAt = Date.now();
      controller.abort();
      await outcome;
      // The rejection must arrive from the abort, not the 60s sleep.
      expect(Date.now() - abortedAt).toBeLessThan(1_000);
      expect(calls).toBe(1);
    });

    it("does not retry when retry is disabled", async () => {
      let calls = 0;
      const fetchMock: typeof fetch = async () => {
        calls++;
        return new Response("unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        });
      };

      await expect(
        new HttpTransport("http://localhost", {
          fetch: fetchMock,
          retry: false,
        }).request("groundhog_chainTip"),
      ).rejects.toThrow("HTTP 503");
      expect(calls).toBe(1);
    });
  });
});
