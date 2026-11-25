import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x } from "../actions/hex.js";
import type { TransactionReceipt } from "../types/rpc.js";
import { createSubmissionEvidence } from "../wallet/execution.js";
import { withTransactionFacts, type TransactionFacts } from "./transaction.js";
import { isThruputError, ThruputError } from "./thruputError.js";

const submission = createSubmissionEvidence(
  fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr),
  new Uint8Array(32).fill(2),
);
const receipt: TransactionReceipt = {
  transactionHash: submission.transactionHash,
  blockHeight: 9n,
  execution: { result: "abort", abortData: new Uint8Array([7]) },
  gasUsed: 5n,
  events: [],
};

function failed() {
  return new ThruputError("transactionFailed", "Transaction failed", {
    cause: new Error("private application detail"),
    transaction: {
      hash: submission.transactionHash,
      outcome: "failed",
      reason: "aborted",
      receipt,
      submission,
    },
  });
}

describe("ThruputError", () => {
  it("keeps the message, code, cause, and frozen context and facts", () => {
    const cause = new Error("private application detail");
    const error = new ThruputError("rpcIncompatible", "Endpoint mismatch", {
      context: { kind: "network" },
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ThruputError");
    expect(error.message).toBe("Endpoint mismatch");
    expect(error.code).toBe("rpcIncompatible");
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ kind: "network" });
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(error).not.toHaveProperty("transaction");
    const withFacts = failed();
    expect(withFacts.transaction).toMatchObject({
      outcome: "failed",
      reason: "aborted",
      receipt,
    });
    expect(Object.isFrozen(withFacts.transaction)).toBe(true);
  });

  it("requires facts for a transaction code", () => {
    expect(
      () =>
        new ThruputError("transactionFailed", "Transaction failed", {
          context: {},
        }),
    ).toThrow(new TypeError("transactionFailed requires transaction facts"));
  });

  it("narrows by code with isThruputError", () => {
    const error: unknown = failed();
    expect(isThruputError(error)).toBe(true);
    expect(isThruputError(error, "transactionFailed")).toBe(true);
    expect(isThruputError(error, "rpcError")).toBe(false);
    if (isThruputError(error, "amountInvalid"))
      expectTypeOf(error.context.kind).toEqualTypeOf<
        "malformed" | "precision"
      >();
    if (isThruputError(error) && error.code === "httpResponseError")
      expectTypeOf(error.context.status).toEqualTypeOf<number>();
    if (isThruputError(error, "transactionOutcomeUnknown"))
      expectTypeOf(error.transaction).toEqualTypeOf<TransactionFacts>();
    if (isThruputError(error) && error.code === "contractCallFailed")
      expectTypeOf(error.transaction).toEqualTypeOf<TransactionFacts>();
    if (isThruputError(error, "rpcError"))
      expectTypeOf(error.transaction).toEqualTypeOf<
        TransactionFacts | undefined
      >();
  });

  it("recognizes errors from another realm or package copy", () => {
    const foreign = runInNewContext(
      'Object.assign(new Error("x"), { name: "ThruputError", code: "rpcError" })',
    );
    expect(foreign instanceof ThruputError).toBe(false);
    expect(isThruputError(foreign, "rpcError")).toBe(true);
    for (const value of [
      null,
      undefined,
      "ThruputError",
      new Error("x"),
      { name: "ThruputError" },
      { name: "ThruputError", code: 4001 },
    ])
      expect(isThruputError(value)).toBe(false);
  });

  it("adds facts to an error without them, and wraps one with another transaction's facts", () => {
    const facts = {
      hash: submission.transactionHash,
      outcome: "unknown",
      reason: "disconnected",
      submission,
    } as const;
    const plain = new ThruputError("httpRequestFailed", "getChainTip failed", {
      context: { endpoint: "https://rpc.example", method: "getChainTip" },
    });
    const added = withTransactionFacts(plain, facts) as ThruputError;
    expect(added).toMatchObject({
      code: "httpRequestFailed",
      message: "getChainTip failed",
      context: { method: "getChainTip" },
      transaction: { outcome: "unknown", reason: "disconnected" },
    });
    const other = new ThruputError("transactionOutcomeUnknown", "Other", {
      transaction: { ...facts, hash: new Uint8Array(32).fill(9) },
    });
    const wrapped = withTransactionFacts(other, facts) as ThruputError;
    expect(wrapped.code).toBe("transactionOutcomeUnknown");
    expect(wrapped.cause).toBe(other);
    expect(wrapped.transaction!.hash).toEqual(submission.transactionHash);
  });
});
