import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x } from "../actions/hex.js";
import { UnsupportedRpcValue } from "../rpc/codec.js";
import type { TransactionReceipt } from "../types/rpc.js";
import { createSubmissionEvidence } from "../wallet/execution.js";
import { parseThruputError } from "./serialize.js";
import { withTransactionFacts } from "./transaction.js";
import type { TransactionFacts } from "./transaction.js";
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

const unknownFacts = {
  hash: submission.transactionHash,
  outcome: "unknown",
  reason: "timeout",
} as const;

// An unknown outcome can only have a receipt whose execution is unsupported.
const unsupportedReceipt: TransactionReceipt = {
  ...receipt,
  execution: new UnsupportedRpcValue({ result: "future" }),
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
      context: { kind: "network" },
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ThruputError");
    expect(error.shortMessage).toBe("Endpoint mismatch");
    expect(error.details).toBe("getChainTip failed");
    expect(error.docsUrl).toBe(
      "https://www.thruput.network/docs/typescript/reference/errors/#rpcincompatible",
    );
    expect(error.docsUrl.startsWith(errorDocsBaseUrl)).toBe(true);
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

  it("returns a new copy of the receipt on each read", () => {
    const error = failed();
    error.transaction!.receipt!.transactionHash.fill(0);
    expect(error.transaction!.receipt!.transactionHash).toEqual(
      submission.transactionHash,
    );
    // The error still matches its own hash, so it round-trips.
    expect(() => parseThruputError(error.toJSON())).not.toThrow();
  });

  it("copies an unsupported value in context", () => {
    const raw = { status: "future" };
    const error = new ThruputError("rpcValueUnsupported", "Unsupported", {
      context: { value: new UnsupportedRpcValue(raw) },
    });
    raw.status = "changed";
    expect(error.context.value.raw).toEqual({ status: "future" });
    expect(Object.isFrozen(error.context.value)).toBe(true);
  });

  it("copies submission bytes that are plain arrays", () => {
    // Plain arrays, not the getter copies of createSubmissionEvidence.
    const signed = submission.signedTransaction;
    const network = submission.networkHash;
    const evidence = {
      signedTransaction: signed,
      transactionHash: submission.transactionHash,
      networkHash: network,
    };
    const error = new ThruputError("transactionNotSubmitted", "Not sent", {
      transaction: {
        hash: evidence.transactionHash,
        outcome: "notSubmitted",
        reason: "cancelled",
        submission: evidence,
      },
    });
    signed.fill(0);
    network.fill(0);
    expect(error.transaction!.submission!.signedTransaction).toEqual(
      signedTransaction,
    );
    expect(error.transaction!.submission!.networkHash).toEqual(
      submission.networkHash,
    );
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
    // @ts-expect-error transaction codes require facts
    void new ThruputError("transactionFailed", "Transaction failed");
    const either = "rpcIncompatible" as "transactionFailed" | "rpcIncompatible";
    // @ts-expect-error a union that includes a transaction code requires facts
    void new ThruputError(either, "failure");
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
    const top = new ThruputError("rpcIncompatible", "top", {
      context: { kind: "network" },
      cause: middle,
    });
    expect(top.walk()).toBe(root);
    expect(
      top.walk((error) => isThruputError(error, "httpRequestFailed")),
    ).toBe(middle);
    expect(top.walk((error) => error === "missing")).toBeNull();
    const looped = new ThruputError("rpcIncompatible", "loop", {
      context: { kind: "network" },
    });
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
        submissionError: new ThruputError("rpcIncompatible", "Mismatch", {
          context: { kind: "network" },
        }),
      },
      cause: new Error("not serialized"),
      transaction: {
        hash: submission.transactionHash,
        outcome: "unknown",
        reason: "timeout",
        receipt: unsupportedReceipt,
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
      receipt: unsupportedReceipt,
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

  it("shortens long messages so the output always parses", () => {
    const error = new ThruputError("rpcIncompatible", "x".repeat(2000), {
      context: { kind: "network" },
      details: "y".repeat(5000),
    });
    const parsed = parseThruputError(JSON.parse(JSON.stringify(error)));
    expect(parsed.shortMessage).toHaveLength(1024);
    expect(parsed.details).toHaveLength(4096);
  });

  it("does not treat serialized output as a live error", () => {
    const json = failed().toJSON();
    expect(isThruputError(json)).toBe(false);
    const error = new ThruputError("transactionOutcomeUnknown", "Stopped", {
      context: { submissionError: json },
      transaction: unknownFacts,
    });
    expect(() => JSON.stringify(error)).not.toThrow();
  });

  it("round-trips RPC data that looks like a serialization tag", () => {
    const data = {
      $error: "upstream unavailable",
      nested: { $bytes: "not hex" },
    };
    const error = new ThruputError("rpcError", "failed (RPC -32050)", {
      context: { code: -32050, rpcMessage: "failed", data, raw: { data } },
    });
    const parsed = parseThruputError(JSON.parse(JSON.stringify(error)));
    expect(parsed.context).toMatchObject({ data, raw: { data } });
    const single = new ThruputError("rpcValueInvalid", "bad", {
      context: { path: "/result", raw: { $error: "x" } },
    });
    expect(
      parseThruputError(JSON.parse(JSON.stringify(single))).context,
    ).toEqual({ path: "/result", raw: { $error: "x" } });
  });

  it("keeps only the name of other errors in context", () => {
    const error = new ThruputError("transactionOutcomeUnknown", "Stopped", {
      context: { submissionError: new TypeError("secret") },
      transaction: unknownFacts,
    });
    const json = error.toJSON();
    expect(JSON.stringify(json)).not.toContain("secret");
    expect(parseThruputError(json).context).toMatchObject({
      submissionError: { name: "TypeError" },
    });
  });

  it("never throws for deep, cyclic, or non-finite context, and its output parses", () => {
    // A node controls RPC error data, so its depth has no limit.
    let deep: unknown = 1;
    for (let level = 0; level < 100; level++) deep = { next: deep };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const error = new ThruputError("rpcValueInvalid", "Invalid", {
      context: { path: "/result", raw: { deep, cyclic, nan: Number.NaN } },
    });
    expect(() => JSON.stringify(error)).not.toThrow();
    const parsed = parseThruputError(structuredClone(error.toJSON()));
    expect(parsed.context).toMatchObject({ raw: { nan: null } });
  });

  it("round-trips a receipt and a nested error at the depth limit", () => {
    const deep = (levels: number, leaf: unknown): unknown => {
      let value = leaf;
      for (let level = 0; level < levels; level++) value = { next: value };
      return value;
    };
    // An unsupported execution value comes from a node, at any depth.
    const unsupported = new ThruputError(
      "transactionOutcomeUnsupported",
      "Unsupported",
      {
        transaction: {
          hash: submission.transactionHash,
          outcome: "unknown",
          reason: "outcomeUnsupported",
          receipt: {
            ...receipt,
            execution: new UnsupportedRpcValue(deep(80, 1)),
          },
        },
      },
    );
    expect(() => parseThruputError(unsupported.toJSON())).not.toThrow();
    // A nested error is kept whole, with its deepest receipt field, or
    // dropped; it is never cut into a form that does not parse.
    const event = {
      address: new Uint8Array(32),
      data: new Uint8Array([1]),
      topics: [new Uint8Array([2])],
    };
    const inner = new ThruputError("transactionFailed", "Failed", {
      transaction: {
        hash: submission.transactionHash,
        outcome: "failed",
        reason: "aborted",
        receipt: { ...receipt, events: [event] },
      },
    });
    for (let levels = 50; levels <= 64; levels++) {
      const nested = new ThruputError("rpcValueInvalid", "Invalid", {
        context: { path: "/result", raw: deep(levels, inner) },
      });
      let leaf = (
        parseThruputError(nested.toJSON()).context as {
          raw: unknown;
        }
      ).raw;
      while (leaf !== null && typeof leaf === "object" && "next" in leaf)
        leaf = leaf.next;
      if (leaf !== null)
        expect(
          (leaf as ThruputError).transaction!.receipt!.events[0]!.topics,
        ).toEqual([new Uint8Array([2])]);
    }
  });

  it("ends on cycles with many branches and on large shared graphs", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.a = cyclic;
    cyclic.b = cyclic;
    // Each level refers twice to the next, so a full walk visits 2^60 nodes.
    let shared: unknown = 1;
    for (let level = 0; level < 60; level++) shared = { a: shared, b: shared };
    const error = new ThruputError("rpcValueInvalid", "Invalid", {
      context: { path: "/result", raw: { cyclic, shared } },
    });
    expect(
      parseThruputError(JSON.parse(JSON.stringify(error))).context,
    ).toMatchObject({
      raw: { cyclic: { a: null, b: null } },
    });
  });

  it("parses a serialized error from another realm", () => {
    const json = JSON.stringify(failed());
    const foreign = runInNewContext(`JSON.parse(${JSON.stringify(json)})`);
    expect(parseThruputError(foreign).code).toBe("transactionFailed");
  });

  it("copies an unsupported value whose raw data refers back to it", () => {
    const raw: Record<string, unknown> = {};
    const value = new UnsupportedRpcValue(raw);
    raw.self = value;
    const error = new ThruputError("rpcValueUnsupported", "Unsupported", {
      context: { value },
    });
    const copy = error.context.value;
    expect((copy.raw as Record<string, unknown>).self).toBe(copy);
  });

  it("keeps only the name of an error from another realm, and its bytes", () => {
    const foreign = runInNewContext(
      'Object.assign(new TypeError("secret"), { apiKey: "sk-secret" })',
    );
    const bytes = runInNewContext("new Uint8Array([1, 2])");
    const error = new ThruputError("rpcValueInvalid", "Invalid", {
      context: { path: "/result", raw: { foreign, bytes } },
    });
    const json = JSON.stringify(error);
    expect(json).not.toContain("secret");
    expect(parseThruputError(JSON.parse(json)).context).toMatchObject({
      raw: { foreign: { name: "TypeError" }, bytes: new Uint8Array([1, 2]) },
    });
  });

  it("keeps a docs link that a package sets for its own code", () => {
    const docsUrl = "https://example.com/errors/#testkitstepfailed";
    const error = new ThruputError("rpcIncompatible", "Incompatible", {
      context: { kind: "network" },
      docsUrl,
    });
    expect(error.message).toContain(`Docs: ${docsUrl}`);
    expect(error.toJSON()).toMatchObject({ version: 1, docsUrl });
    expect(parseThruputError(error.toJSON()).docsUrl).toBe(docsUrl);
    // The default link is not written, because the code gives it.
    expect(failed().toJSON()).not.toHaveProperty("docsUrl");
    // Adding facts keeps the link.
    expect(
      withTransactionFacts(error, unknownFacts) as ThruputError,
    ).toMatchObject({ docsUrl });
    // A link that the serialized form cannot carry is rejected at once.
    for (const invalidUrl of [
      "http://localhost:3000/errors",
      "/errors",
      `https://example.com/${"x".repeat(2048)}`,
    ])
      expect(
        () =>
          new ThruputError("rpcIncompatible", "Incompatible", {
            context: { kind: "network" },
            docsUrl: invalidUrl,
          }),
      ).toThrow(TypeError);
  });

  it("takes details only from text in a cause", () => {
    const forged = Object.assign(new Error("forged"), {
      name: "ThruputError",
      code: "rpcError",
      shortMessage: { secret: 1 },
    });
    const error = new ThruputError("rpcIncompatible", "Incompatible", {
      context: { kind: "network" },
      cause: forged,
    });
    expect(error.details).toBeUndefined();
    expect(() => JSON.stringify(error)).not.toThrow();
  });

  it.each([
    ["a non-object", "x"],
    ["a live error", failed()],
    ["another format version", { ...failed().toJSON(), version: 2 }],
    ["no format version", { ...failed().toJSON(), version: undefined }],
    [
      "a docs link that is not https",
      { ...failed().toJSON(), docsUrl: "javascript:alert(1)" },
    ],
    [
      "a tag as the whole context",
      { ...failed().toJSON(), context: { $bigint: "5" } },
    ],
    [
      "a value that is not JSON",
      { ...failed().toJSON(), context: { value: 5n } },
    ],
    [
      "a reason that contradicts a failed receipt",
      {
        ...failed().toJSON(),
        transaction: { ...failed().toJSON().transaction, reason: "faulted" },
      },
    ],
    [
      "a failed outcome without a receipt",
      {
        ...failed().toJSON(),
        code: "contractCallFailed",
        transaction: { ...failed().toJSON().transaction, receipt: undefined },
      },
    ],
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
      "a receipt without an execution result",
      {
        ...failed().toJSON(),
        transaction: {
          ...failed().toJSON().transaction,
          receipt: {
            transactionHash: { $bytes: failed().toJSON().transaction!.hash },
          },
        },
      },
    ],
    [
      "an outcome that contradicts the receipt",
      {
        ...failed().toJSON(),
        transaction: {
          ...failed().toJSON().transaction,
          outcome: "notSubmitted",
        },
      },
    ],
    [
      "an outcome that contradicts the code",
      {
        ...failed().toJSON(),
        transaction: {
          ...failed().toJSON().transaction,
          outcome: "unknown",
          receipt: undefined,
        },
      },
    ],
    [
      "a transaction code without facts",
      { ...failed().toJSON(), transaction: undefined },
    ],
    [
      "a malformed bigint",
      { ...failed().toJSON(), context: { value: { $bigint: "1.5" } } },
    ],
  ])("rejects %s", (_, value) => {
    expect(() => parseThruputError(value)).toThrow(TypeError);
  });
});
