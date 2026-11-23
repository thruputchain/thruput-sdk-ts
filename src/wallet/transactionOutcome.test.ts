import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x } from "../actions/hex.js";
import {
  waitForCommitment,
  waitForTransactionReceipt,
} from "../actions/public/waitForTransactionReceipt.js";
import { toBase58 } from "../encoding.js";
import type { TransactionReason } from "../errors/transaction.js";
import { rpcIncompatible } from "../rpc/client.js";
import { rpcRequestInvalid } from "../rpc/codec.js";
import { nativeRpcError } from "../rpc/errorReader.js";
import type { RpcClient } from "../rpc/client.js";
import { httpRequestFailed, rpcError } from "../transport/errors.js";
import type { TransactionReceipt, TransactionStatus } from "../types/rpc.js";
import { createSubmissionEvidence, submitAndObserve } from "./execution.js";
import { withTransactionFacts } from "../errors/transaction.js";
import { ThruputError } from "../errors/thruputError.js";

// One test for each row of the transaction reason table in the design.

const networkHash = new Uint8Array(32).fill(2);
const evidence = createSubmissionEvidence(
  fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr),
  networkHash,
);
const hash = evidence.transactionHash;
const rejections = {
  invalidParams: [-32602, { kind: "invalidParams" }],
  transactionInvalid: [
    -32000,
    { kind: "transactionInvalid", admission: "notAttempted" },
  ],
  transactionRejected: [
    -32001,
    { kind: "transactionRejected", admission: "rejected" },
  ],
} as const;
const rejected = (kind: keyof typeof rejections) => {
  const [code, data] = rejections[kind];
  const error = nativeRpcError(
    rpcError(code, "rejected", data).context,
    "sendTransaction",
  );
  expect(error.context.kind).toBe(kind);
  return error;
};

function observer(
  overrides: Partial<{
    receipt: () => Promise<TransactionReceipt | null>;
    status: () => Promise<TransactionStatus>;
    network: () => Promise<{ networkHash: Uint8Array }>;
  }> = {},
) {
  return {
    discovery: { network: { networkHash } },
    requireMethods: vi.fn(),
    getNetworkInfo: vi.fn(overrides.network ?? (async () => ({ networkHash }))),
    getTransactionReceipt: vi.fn(overrides.receipt ?? (async () => null)),
    getTransactionStatus: vi.fn(
      overrides.status ??
        (async (): Promise<TransactionStatus> => ({ status: "pending" })),
    ),
  } as unknown as RpcClient;
}

async function observe(
  client: RpcClient,
  options: Parameters<typeof waitForTransactionReceipt>[2] = {},
) {
  return waitForTransactionReceipt(client, hash, {
    timeoutMs: 1000,
    pollingIntervalMs: 10,
    ...options,
  }).catch((error: unknown) => error);
}

function expectFacts(
  error: unknown,
  code: string,
  outcome: string,
  reason: TransactionReason,
) {
  expect(error).toMatchObject({
    name: "ThruputError",
    code,
    transaction: { outcome, reason },
  });
}

afterEach(() => vi.useRealTimers());

describe("submitAndObserve reasons", () => {
  const client = { waitForTransactionReceipt: vi.fn() };
  const submit = (error: unknown) => vi.fn().mockRejectedValue(error);

  it("reports cancellation before dispatch", async () => {
    const reason = new Error("stop");
    const error = await submitAndObserve(client, evidence, vi.fn(), {
      signal: AbortSignal.abort(reason),
    }).catch((e) => e);
    expectFacts(error, "transactionNotSubmitted", "notSubmitted", "cancelled");
    expect(error.cause).toBe(reason);
  });

  it("reports a zero time budget before dispatch", async () => {
    const error = await submitAndObserve(client, evidence, vi.fn(), {
      timeoutMs: 0,
    }).catch((e) => e);
    expectFacts(error, "transactionNotSubmitted", "notSubmitted", "timeout");
    expect(error.cause.name).toBe("TimeoutError");
  });

  it("reports a request that the transport did not send", async () => {
    const error = await submitAndObserve(
      client,
      evidence,
      submit(new Error("session changed")),
      undefined,
      () => false,
    ).catch((e) => e);
    expectFacts(
      error,
      "transactionNotSubmitted",
      "notSubmitted",
      "notDispatched",
    );
  });

  it.each([
    rpcRequestInvalid("/params/signedTransaction"),
    rpcIncompatible("Endpoint does not advertise sendTransaction"),
  ])(
    "reports a local request failure before dispatch: $code",
    async (cause) => {
      const error = await submitAndObserve(
        client,
        evidence,
        submit(cause),
      ).catch((e) => e);
      expectFacts(
        error,
        "transactionNotSubmitted",
        "notSubmitted",
        "requestInvalid",
      );
    },
  );

  it.each([
    "invalidParams",
    "transactionInvalid",
    "transactionRejected",
  ] as const)(
    "keeps a node rejection (%s) unknown and does not observe",
    async (kind) => {
      const wait = vi.fn();
      const error = await submitAndObserve(
        { waitForTransactionReceipt: wait },
        evidence,
        submit(rejected(kind)),
      ).catch((e) => e);
      expectFacts(
        error,
        "transactionOutcomeUnknown",
        "unknown",
        "nodeRejected",
      );
      expect(error.transaction.submission.transactionHash).toEqual(hash);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it("never reads the code of an abort reason as proof of no dispatch", async () => {
    const controller = new AbortController();
    const reason = rpcIncompatible("from another operation");
    const error = await submitAndObserve(
      client,
      evidence,
      async () => {
        // The node may have the bytes; the caller then aborts with an SDK error.
        controller.abort(reason);
        throw reason;
      },
      { signal: controller.signal },
    ).catch((e) => e);
    expectFacts(error, "transactionOutcomeUnknown", "unknown", "cancelled");
    expect(error.cause).toBe(reason);
  });

  it("reports cancellation after dispatch as unknown", async () => {
    const controller = new AbortController();
    const error = await submitAndObserve(
      client,
      evidence,
      async () => {
        controller.abort(new Error("stop"));
        throw new Error("connection reset");
      },
      { signal: controller.signal },
    ).catch((e) => e);
    expectFacts(error, "transactionOutcomeUnknown", "unknown", "cancelled");
  });

  it("reports a submission timeout as unknown", async () => {
    vi.useFakeTimers();
    const pending = submitAndObserve(
      client,
      evidence,
      () => new Promise(() => {}),
      { timeoutMs: 50 },
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(60);
    expectFacts(
      await pending,
      "transactionOutcomeUnknown",
      "unknown",
      "timeout",
    );
  });

  it("observes after an ambiguous submission and keeps the submission error", async () => {
    const lost = httpRequestFailed(
      "https://rpc.example",
      "sendTransaction",
      new TypeError("fetch failed"),
    );
    const error = await submitAndObserve(
      {
        waitForTransactionReceipt: (h, o) =>
          waitForTransactionReceipt(observer(), h, o),
      },
      evidence,
      submit(lost),
      { timeoutMs: 30, pollingIntervalMs: 5 },
    ).catch((e) => e);
    expectFacts(error, "transactionOutcomeUnknown", "unknown", "timeout");
    expect(error.context.submissionError).toBe(lost);
    expect(error.transaction.submission.signedTransaction).toEqual(
      evidence.signedTransaction,
    );
  });
});

describe("observation reasons", () => {
  it("reports a plain timeout", async () => {
    const error = await observe(observer(), { timeoutMs: 30 });
    expectFacts(error, "transactionOutcomeUnknown", "unknown", "timeout");
    expect(error).toMatchObject({
      context: { lastStatus: { status: "pending" } },
    });
  });

  it("reports a timeout after read failures as disconnected", async () => {
    const lost = httpRequestFailed(
      "https://rpc.example",
      "getTransactionReceipt",
      new TypeError("fetch failed"),
    );
    const error = await observe(
      observer({
        receipt: async () => {
          throw lost;
        },
      }),
      { timeoutMs: 30 },
    );
    expectFacts(error, "transactionOutcomeUnknown", "unknown", "disconnected");
    expect((error as Error).cause).toBe(lost);
  });

  it.each([
    ["statusUnknown", { status: "unknown" }],
    ["statusUnknown", { status: "other" }],
    [
      "recentFailure",
      { status: "recentFailure", attemptBlockHeight: 3n, cause: { kind: "x" } },
    ],
  ] as const)("reports %s from the last status", async (reason, status) => {
    const error = await observe(
      observer({ status: async () => status as unknown as TransactionStatus }),
      { timeoutMs: 30 },
    );
    expectFacts(error, "transactionOutcomeUnknown", "unknown", reason);
  });

  it("reports a network change", async () => {
    const error = await observe(
      observer({ network: async () => ({ networkHash: new Uint8Array(32) }) }),
    );
    expectFacts(
      error,
      "transactionOutcomeUnknown",
      "unknown",
      "networkChanged",
    );
    expect(error).toMatchObject({ cause: { code: "rpcIncompatible" } });
  });

  it("reports conflicting commitment heights", async () => {
    const error = await observe(
      observer({
        status: async () => ({ status: "committed", blockHeight: 4n }),
      }),
      {
        knownCommitment: {
          transactionHash: hash,
          networkHash,
          blockHeight: 3n,
        },
      },
    );
    expectFacts(
      error,
      "transactionOutcomeUnknown",
      "unknown",
      "commitmentConflict",
    );
  });

  it("reports a permanent read failure", async () => {
    const error = await observe(
      observer({
        receipt: async () => {
          throw rejected("invalidParams");
        },
      }),
    );
    expectFacts(
      error,
      "transactionOutcomeUnknown",
      "unknown",
      "observationFailed",
    );
  });

  it("takes no commitment from an abort reason", async () => {
    // A receipt error for another transaction, carrying its block height.
    const other = nativeRpcError(
      rpcError(-32054, "invalid", {
        kind: "backendDataInvalid",
        observation: {
          blockHeight: "7",
          transactionHash: toBase58(new Uint8Array(32).fill(9)),
        },
      }).context,
      "getTransactionReceipt",
    );
    expect(other.context.kind).toBe("backendDataInvalid");
    const controller = new AbortController();
    const error = await waitForCommitment(
      observer({
        receipt: async () => {
          controller.abort(other);
          throw other;
        },
      }),
      hash,
      { signal: controller.signal },
    ).catch((e: unknown) => e);
    expectFacts(error, "transactionOutcomeUnknown", "unknown", "cancelled");
    expect(error).toMatchObject({ cause: other });
  });

  it("reports cancellation", async () => {
    const controller = new AbortController();
    const pending = observe(observer(), { signal: controller.signal });
    controller.abort(new Error("stop"));
    expectFacts(
      await pending,
      "transactionOutcomeUnknown",
      "unknown",
      "cancelled",
    );
  });
});

describe("withTransactionFacts", () => {
  const facts = {
    hash,
    outcome: "unknown",
    reason: "disconnected",
    submission: evidence,
  } as const;

  it("adds facts to an error without them, keeping its code", () => {
    const error = httpRequestFailed(
      "https://rpc.example",
      "sendTransaction",
      0,
    );
    expect(withTransactionFacts(error, facts)).toMatchObject({
      code: "httpRequestFailed",
      transaction: { outcome: "unknown", reason: "disconnected" },
    });
  });

  it("wraps an error whose facts describe another transaction", () => {
    const other = new ThruputError("transactionNotSubmitted", "Earlier", {
      transaction: {
        hash: new Uint8Array(32).fill(9),
        outcome: "notSubmitted",
        reason: "cancelled",
      },
    });
    const wrapped = withTransactionFacts(other, facts);
    expect(wrapped).toMatchObject({
      code: "transactionOutcomeUnknown",
      cause: other,
      transaction: { outcome: "unknown" },
    });
    expect((wrapped as ThruputError).transaction!.hash).toEqual(hash);
  });
});
