import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x } from "../actions/hex.js";
import { UnsupportedRpcValue } from "../rpc/codec.js";
import type { TransactionReceipt } from "../types/rpc.js";
import { createSubmissionEvidence } from "../wallet/execution.js";
import { parseThruputError } from "./serialize.js";
import {
  errorDocsBaseUrl,
  isThruputError,
  ThruputError,
} from "./thruputError.js";

const signedTransaction = fromHex0x(
  "0x" + vectors.signing[0]!.signed_transaction_xdr,
);
const submission = createSubmissionEvidence(
  signedTransaction,
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
  it("builds a message from the short message, details, and docs link", () => {
    const cause = new ThruputError("httpRequestFailed", "getChainTip failed", {
      context: { endpoint: "https://rpc.example", method: "getChainTip" },
    });
    const error = new ThruputError("rpcIncompatible", "Endpoint mismatch", {
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ThruputError");
    expect(error.shortMessage).toBe("Endpoint mismatch");
    expect(error.details).toBe("getChainTip failed");
    expect(error.docsUrl).toBe(`${errorDocsBaseUrl}#rpcincompatible`);
    expect(error.message).toBe(
      `Endpoint mismatch\n\nDetails: getChainTip failed\n\nDocs: ${error.docsUrl}`,
    );
    expect(error.cause).toBe(cause);
  });

  it("never copies messages from causes that the client does not own", () => {
    const error = failed();
    expect(error.details).toBeUndefined();
    expect(error.message).not.toContain("private application detail");
    expect(Object.keys(error)).not.toContain("details");
  });

  it("copies and freezes context, including Buffer bytes", () => {
    const raw = { nested: { bytes: Buffer.from([1, 2, 3]) } };
    const error = new ThruputError("rpcValueInvalid", "Invalid value", {
      context: { path: "/result", raw },
    });
    raw.nested.bytes.fill(9);
    expect(error.context.raw).toEqual({
      nested: { bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(Object.isFrozen((error.context.raw as typeof raw).nested)).toBe(
      true,
    );
  });

  it("does not let a __proto__ key change the context prototype", () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true}}');
    const error = new ThruputError("rpcResponseInvalid", "Bad reply", {
      context: { raw },
    });
    const copy = error.context.raw as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.hasOwn(copy, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("returns a new copy of the transaction hash on each read", () => {
    const error = failed();
    const hash = error.transaction!.hash;
    hash.fill(0);
    expect(error.transaction!.hash).toEqual(submission.transactionHash);
    expect(Object.isFrozen(error.transaction)).toBe(true);
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

  it("walks the cause chain and stops at cycles", () => {
    const root = new Error("root");
    const middle = new ThruputError("httpRequestFailed", "failed", {
      context: { endpoint: "https://rpc.example", method: "getChainTip" },
      cause: root,
    });
    const top = new ThruputError("rpcIncompatible", "top", { cause: middle });
    expect(top.walk()).toBe(root);
    expect(
      top.walk((error) => isThruputError(error, "httpRequestFailed")),
    ).toBe(middle);
    expect(top.walk((error) => error === "missing")).toBeNull();
    const looped = new ThruputError("rpcIncompatible", "loop");
    Object.defineProperty(looped, "cause", { value: looped });
    expect(looped.walk()).toBe(looped);
  });
});

describe("ThruputError serialization", () => {
  it("round-trips through JSON and structured clone", () => {
    const error = new ThruputError("transactionOutcomeUnknown", "Stopped", {
      context: {
        knownCommitment: {
          networkHash: submission.networkHash,
          transactionHash: submission.transactionHash,
          blockHeight: 9n,
        },
        lastStatus: new UnsupportedRpcValue({ status: "future" }),
        submissionError: new ThruputError("rpcIncompatible", "Mismatch"),
      },
      cause: new Error("not serialized"),
      transaction: {
        hash: submission.transactionHash,
        outcome: "unknown",
        reason: "timeout",
        receipt,
        submission,
      },
    });
    const wire = structuredClone(JSON.parse(JSON.stringify(error)));
    const parsed = parseThruputError(wire);
    expect(parsed).toBeInstanceOf(ThruputError);
    expect(parsed.code).toBe("transactionOutcomeUnknown");
    expect(parsed.message).toBe(error.message);
    expect(parsed.cause).toBeUndefined();
    expect(parsed.transaction).toMatchObject({
      outcome: "unknown",
      reason: "timeout",
      receipt,
    });
    expect(parsed.transaction!.hash).toEqual(submission.transactionHash);
    expect(parsed.transaction!.submission!.signedTransaction).toEqual(
      signedTransaction,
    );
    if (!isThruputError(parsed, "transactionOutcomeUnknown"))
      throw new Error("expected transactionOutcomeUnknown");
    expect(parsed.context.knownCommitment?.blockHeight).toBe(9n);
    expect(parsed.context.lastStatus).toBeInstanceOf(UnsupportedRpcValue);
    expect(parsed.context.submissionError).toMatchObject({
      code: "rpcIncompatible",
      shortMessage: "Mismatch",
    });
  });

  it("keeps only the name of other errors in context", () => {
    const error = new ThruputError("transactionOutcomeUnknown", "Stopped", {
      context: { submissionError: new TypeError("secret") },
    });
    const json = error.toJSON();
    expect(JSON.stringify(json)).not.toContain("secret");
    expect(parseThruputError(json).context).toMatchObject({
      submissionError: { name: "TypeError" },
    });
  });

  it.each([
    ["a non-object", "x"],
    ["another name", { ...failed().toJSON(), name: "Error" }],
    ["a malformed code", { ...failed().toJSON(), code: "Bad-Code" }],
    [
      "a long message",
      { ...failed().toJSON(), shortMessage: "x".repeat(1025) },
    ],
    ["missing context", { ...failed().toJSON(), context: undefined }],
    [
      "a short hash",
      {
        ...failed().toJSON(),
        transaction: { ...failed().toJSON().transaction, hash: "0x00" },
      },
    ],
    [
      "an unknown outcome",
      {
        ...failed().toJSON(),
        transaction: { ...failed().toJSON().transaction, outcome: "maybe" },
      },
    ],
    [
      "a submission for another hash",
      {
        ...failed().toJSON(),
        transaction: {
          ...failed().toJSON().transaction,
          hash: "0x" + "00".repeat(32),
          receipt: undefined,
        },
      },
    ],
    [
      "a malformed bigint",
      { ...failed().toJSON(), context: { value: { $bigint: "1.5" } } },
    ],
  ])("rejects %s", (_, value) => {
    expect(() => parseThruputError(value)).toThrow(TypeError);
  });
});
