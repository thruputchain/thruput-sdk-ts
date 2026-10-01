import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { classifyReadError } from "./readError.js";
import {
  GroundhogRpcErrorCode,
  HttpRequestError,
  HttpResponseError,
  JsonRpcError,
} from "./http.js";
import { ContractDecodeError } from "../contract/errors.js";
import { ContractViewError } from "../contract/method.js";
import { InvalidTransactionReceiptError } from "../actions/public/getTransactionReceipt.js";

describe("read error classification", () => {
  it.each([408, 429, 500, 502, 503, 504])(
    "classifies HTTP %s as transient",
    (status) => {
      expect(classifyReadError(new HttpResponseError(status, "retry"))).toBe(
        "transient",
      );
    },
  );
  it.each([400, 401, 403, 404, 501, 505, 511])(
    "classifies HTTP %s as permanent",
    (status) => {
      expect(classifyReadError(new HttpResponseError(status, "stop"))).toBe(
        "permanent",
      );
    },
  );
  it.each([
    [GroundhogRpcErrorCode.BackendUnavailable, "transient"],
    [GroundhogRpcErrorCode.BackendTimeout, "transient"],
    [GroundhogRpcErrorCode.Overloaded, "transient"],
    [GroundhogRpcErrorCode.InvalidParams, "permanent"],
    [GroundhogRpcErrorCode.TxInvalid, "permanent"],
    [GroundhogRpcErrorCode.TxRejected, "permanent"],
    [GroundhogRpcErrorCode.NotImplemented, "permanent"],
    [GroundhogRpcErrorCode.TxNotFound, "unknown"],
    [GroundhogRpcErrorCode.BlockNotFound, "unknown"],
    [-32603, "unknown"],
  ] as const)("classifies RPC %s as %s", (code, expected) => {
    expect(classifyReadError(new JsonRpcError(code, "failure"))).toBe(expected);
  });

  it("distinguishes network errors from unrelated TypeErrors", () => {
    const cause = new TypeError("fetch failed");
    const error = new HttpRequestError(
      "https://rpc.example",
      "groundhog_view",
      cause,
    );
    expect(classifyReadError(error)).toBe("transient");
    expect(error.cause).toBe(cause);
    expect(classifyReadError(cause)).toBe("unknown");
  });

  it("preserves plain wrapper causes and terminates cycles", () => {
    const cause = new HttpResponseError(503, "unavailable");
    const wrapped = new Error("read failed", { cause });
    expect(classifyReadError(wrapped)).toBe("transient");
    expect(wrapped.cause).toBe(cause);
    wrapped.cause = wrapped;
    expect(classifyReadError(wrapped)).toBe("unknown");
  });

  it("does not unwrap domain or malformed-response errors into retries", () => {
    const cause = new HttpResponseError(503, "unavailable");
    for (const error of [
      new ContractDecodeError("bad calldata", { cause }),
      new InvalidTransactionReceiptError("bad receipt", { cause }),
      new ContractViewError({
        kind: "fault",
        height: 1n,
        gasUsed: 42n,
        events: [],
      }),
      new SyntaxError("bad JSON"),
      new Error("Invalid JSON-RPC response"),
    ])
      expect(classifyReadError(error)).toBe("unknown");
  });

  it("distinguishes request timeouts from caller cancellation", () => {
    const timeout = new DOMException("timeout", "TimeoutError");
    expect(classifyReadError(timeout)).toBe("transient");
    expect(
      classifyReadError(timeout, { signal: AbortSignal.abort(timeout) }),
    ).toBe("cancelled");
    expect(classifyReadError(new DOMException("stop", "AbortError"))).toBe(
      "cancelled",
    );
    expect(
      classifyReadError("user stopped", {
        signal: AbortSignal.abort("user stopped"),
      }),
    ).toBe("cancelled");
  });

  it("recognizes named cancellation from another realm", () => {
    const error = runInNewContext(
      'Object.assign(new Error("stop"), { name: "AbortError" })',
    );
    expect(classifyReadError(error)).toBe("cancelled");
  });

  it.each([null, undefined, "failure", 5, {}])(
    "leaves unrecognized values unknown: %j",
    (error) => {
      expect(classifyReadError(error)).toBe("unknown");
    },
  );
});
