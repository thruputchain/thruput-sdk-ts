import { describe, expect, it } from "vitest";
import {
  decodeResult,
  RpcDecodingError,
  UnsupportedRpcValue,
} from "./codec.js";
import type { RpcTransactionStatus } from "./generated.js";

const diagnostic = {
  attemptBlockHeight: "7",
  cause: { kind: "contractRejected", contractIndex: 0, code: "notDeployable" },
};
const schedulerError = { source: "executor", code: 3 };
const decode = (raw: unknown) =>
  decodeResult("getTransactionStatus", raw) as RpcTransactionStatus;

describe("optional status attempt diagnostics", () => {
  it.each(["pending", "retry", "dropped"] as const)(
    "decodes %s with and without an independently observed failure",
    (status) => {
      const base =
        status === "pending" ? { status } : { status, error: schedulerError };
      const withoutDiagnostic = decode(base);
      expect(withoutDiagnostic).toStrictEqual(base);
      expect(withoutDiagnostic).not.toHaveProperty("recentFailure");
      expect(decode({ ...base, recentFailure: diagnostic })).toEqual({
        ...base,
        recentFailure: { ...diagnostic, attemptBlockHeight: 7n },
      });
    },
  );

  it.each(["0", "9223372036854775807"])(
    "accepts canonical attempt block height %s",
    (attemptBlockHeight) => {
      expect(
        decode({
          status: "pending",
          recentFailure: { ...diagnostic, attemptBlockHeight },
        }),
      ).toMatchObject({
        recentFailure: { attemptBlockHeight: BigInt(attemptBlockHeight) },
      });
    },
  );

  it.each([
    null,
    {},
    { cause: diagnostic.cause },
    ...[7, "07", "-1", "9223372036854775808", "7.0", "+7", " 7", null].map(
      (attemptBlockHeight) => ({ ...diagnostic, attemptBlockHeight }),
    ),
    { attemptBlockHeight: "07", cause: { kind: "futureFailure", detail: 1 } },
    { attemptBlockHeight: "7" },
    { ...diagnostic, cause: null },
    {
      ...diagnostic,
      cause: { kind: "contractRejected", code: "notDeployable" },
    },
  ])(
    "rejects malformed known diagnostics and retains the complete response: %j",
    (recentFailure) => {
      const raw = { status: "retry", error: schedulerError, recentFailure };
      let caught: unknown;
      try {
        decode(raw);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RpcDecodingError);
      expect((caught as RpcDecodingError).raw).toBe(raw);
    },
  );

  it("preserves an unknown nested cause without losing the scheduler status", () => {
    const cause = { kind: "futureFailure", payload: { nested: [1, "two"] } };
    const decoded = decode({
      status: "retry",
      error: schedulerError,
      recentFailure: { attemptBlockHeight: "7", cause },
    });
    expect(decoded).toMatchObject({ status: "retry", error: schedulerError });
    if (decoded instanceof UnsupportedRpcValue || decoded.status !== "retry")
      throw Error("expected retry");
    expect(decoded.recentFailure?.cause).toBeInstanceOf(UnsupportedRpcValue);
    expect((decoded.recentFailure?.cause as UnsupportedRpcValue).raw).toEqual(
      cause,
    );
  });

  it("preserves an unknown diagnostic enum value", () => {
    const decoded = decode({
      status: "pending",
      recentFailure: {
        ...diagnostic,
        cause: { ...diagnostic.cause, code: "futureCode" },
      },
    });
    if (decoded instanceof UnsupportedRpcValue || decoded.status !== "pending")
      throw Error("expected pending");
    const cause = decoded.recentFailure!.cause;
    if (
      cause instanceof UnsupportedRpcValue ||
      cause.kind !== "contractRejected"
    )
      throw Error("expected contract rejection");
    expect(cause.code).toBeInstanceOf(UnsupportedRpcValue);
    expect((cause.code as UnsupportedRpcValue).raw).toBe("futureCode");
  });

  it("keeps standalone failure and committed response shapes unchanged", () => {
    expect(decode({ status: "recentFailure", ...diagnostic })).toEqual({
      status: "recentFailure",
      ...diagnostic,
      attemptBlockHeight: 7n,
    });
    expect(decode({ status: "committed", blockHeight: "9" })).toEqual({
      status: "committed",
      blockHeight: 9n,
    });
  });
});
