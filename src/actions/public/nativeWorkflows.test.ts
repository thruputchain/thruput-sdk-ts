import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../../rpc/client.js";
import { UnsupportedRpcValue, RpcDecodingError } from "../../rpc/codec.js";
import { NativeRpcError } from "../../rpc/errorReader.js";
import { JsonRpcError } from "../../transport/http.js";
import {
  waitForTransactionReceipt,
  waitForCommitment,
  TransactionReceiptObservationError,
} from "./waitForTransactionReceipt.js";
import { requestAirdrop, FundingObservationError } from "./requestAirdrop.js";
import {
  assertTransactionSuccess,
  createSubmissionEvidence,
  submitAndObserve,
  TransactionObservationError,
  TransactionExecutionError,
  UnsupportedTransactionOutcomeError,
} from "../../wallet/execution.js";
import type { TransactionReceipt } from "../../types/rpc.js";
import vectors from "../../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x } from "../hex.js";
import { toBase58 } from "../../encoding.js";
import { NativeRpcErrorCode } from "../../rpc/errors.js";

const hash = new Uint8Array(32).fill(1);
const networkHash = new Uint8Array(32).fill(2);
const recipient = new Uint8Array(32).fill(3);
const receipt: TransactionReceipt = {
  transactionHash: hash,
  blockHeight: 9n,
  execution: { result: "return", returnData: new Uint8Array() },
  gasUsed: 5n,
  events: [],
};
function client() {
  const c = {
    discovery: { network: { networkHash } },
    requireMethods: vi.fn(),
    getNetworkInfo: vi.fn(async () => ({ networkHash })),
    getTransactionReceipt: vi.fn(
      async () => receipt as TransactionReceipt | null,
    ),
    getTransactionStatus: vi.fn(async () => ({ status: "unknown" })),
    faucet_requestAirdrop: vi.fn(async () => ({
      attemptStatus: "pending",
      recipient,
      rawAmount: 42n,
      transactionHash: hash,
    })),
  };
  return c as unknown as RpcClient & typeof c;
}
afterEach(() => vi.useRealTimers());
describe("native read observation", () => {
  it("returns failed receipts and lets the success assertion decide", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue({
      ...receipt,
      execution: { result: "fault" },
    } as TransactionReceipt);
    const result = await waitForTransactionReceipt(c, hash);
    expect(result.execution).toEqual({ result: "fault" });
    expect(() => assertTransactionSuccess(result)).toThrow(
      `Transaction ${toBase58(hash)} execution failed (fault)`,
    );
  });
  it("reports the known execution result and retains the complete receipt", () => {
    const failed = {
      ...receipt,
      execution: { result: "abort" as const, abortData: new Uint8Array([7]) },
    };
    let caught: unknown;
    try {
      assertTransactionSuccess(failed);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TransactionExecutionError);
    expect((caught as TransactionExecutionError).message).toBe(
      `Transaction ${toBase58(hash)} execution failed (abort)`,
    );
    expect((caught as TransactionExecutionError).receipt).toBe(failed);
  });
  it("does not interpret an unknown execution variant", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue({
      ...receipt,
      execution: new UnsupportedRpcValue({ result: "future", newPayload: 7 }),
    });
    const result = await waitForTransactionReceipt(c, hash);
    expect(() => assertTransactionSuccess(result)).toThrow(
      UnsupportedTransactionOutcomeError,
    );
    const error = new UnsupportedTransactionOutcomeError(result);
    expect(error.message).toBe(
      `Transaction ${toBase58(hash)} has an unsupported execution outcome`,
    );
    expect(error.message).not.toMatch(/failed/);
    expect(error.receipt).toBe(result);
  });
  it("keeps commitment through retry, dropped, unknown and lookup errors", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const statuses = [
      { status: "committed", blockHeight: 9n },
      { status: "retry" },
      { status: "dropped" },
      { status: "unknown" },
    ];
    c.getTransactionStatus.mockImplementation(async () => {
      const next = statuses.shift();
      if (next) return next;
      throw Error("lookup unavailable");
    });
    const outcome = waitForTransactionReceipt(c, hash, {
      timeoutMs: 60,
      pollingIntervalMs: 10,
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(70);
    const error = await outcome;
    expect(error.knownCommitment).toEqual({
      transactionHash: hash,
      networkHash,
      blockHeight: 9n,
    });
    expect(error.lastStatus).toEqual({ status: "committed", blockHeight: 9n });
  });
  it("reports retry diagnostics and retains them on timeout without writing", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const status = {
      status: "retry" as const,
      error: { source: "executor" as const, code: 3 },
      recentFailure: {
        attemptBlockHeight: 7n,
        cause: { kind: "other" as const },
      },
    };
    c.getTransactionStatus.mockResolvedValue(status as never);
    const onStatus = vi.fn((observed: unknown) => {
      // A caller mutating its callback value cannot corrupt retained evidence.
      (observed as typeof status).recentFailure.attemptBlockHeight = 99n;
    });
    const outcome = waitForTransactionReceipt(c, hash, {
      timeoutMs: 10,
      pollingIntervalMs: 20,
      onStatus,
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(11);
    const error = await outcome;
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(error.lastStatus).toEqual({
      status: "retry",
      error: { source: "executor", code: 3 },
      recentFailure: { attemptBlockHeight: 7n, cause: { kind: "other" } },
    });
    expect(error.knownCommitment).toBeUndefined();
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });

  it("retains unsupported nested diagnostics as unsupported timeout evidence", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const raw = { kind: "futureFailure", details: [1, { code: "futureCode" }] };
    c.getTransactionStatus.mockResolvedValue({
      status: "pending",
      recentFailure: {
        attemptBlockHeight: 7n,
        cause: new UnsupportedRpcValue(raw),
      },
    } as never);
    const outcome = waitForTransactionReceipt(c, hash, {
      timeoutMs: 10,
      pollingIntervalMs: 20,
      onStatus: () => {
        raw.details.length = 0;
      },
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(11);
    const error = await outcome;
    expect(error.lastStatus.recentFailure.cause).toBeInstanceOf(
      UnsupportedRpcValue,
    );
    expect(error.lastStatus.recentFailure.cause.raw).toEqual({
      kind: "futureFailure",
      details: [1, { code: "futureCode" }],
    });
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });

  it("delivers later attempt diagnostics without replacing known commitment", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const status = {
      status: "dropped" as const,
      error: { source: "executor" as const, code: 3 },
      recentFailure: {
        attemptBlockHeight: 7n,
        cause: new UnsupportedRpcValue({ kind: "futureFailure", detail: 2 }),
      },
    };
    c.getTransactionStatus.mockResolvedValue(status as never);
    const onStatus = vi.fn();
    const outcome = waitForTransactionReceipt(c, hash, {
      knownCommitment: { transactionHash: hash, networkHash, blockHeight: 9n },
      timeoutMs: 10,
      pollingIntervalMs: 20,
      onStatus,
    }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(11);
    const error = await outcome;
    expect(onStatus).toHaveBeenCalledWith(status);
    expect(error.lastStatus).toEqual({ status: "committed", blockHeight: 9n });
    expect(error.knownCommitment.blockHeight).toBe(9n);
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });
  it("stops on malformed status rather than polling until timeout", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const cause = new RpcDecodingError("status", {
      status: "committed",
      blockHeight: 2,
    });
    c.getTransactionStatus.mockRejectedValue(cause);
    const error = await waitForTransactionReceipt(c, hash).catch(
      (error) => error,
    );
    expect(error.cause).toBe(cause);
    expect(c.getTransactionStatus).toHaveBeenCalledTimes(1);
  });
  it("propagates status callback failure while retaining observed commitment", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    c.getTransactionStatus.mockResolvedValue({
      status: "committed",
      blockHeight: 9n,
    } as never);
    const cause = Error("observer failed");
    const error = await waitForTransactionReceipt(c, hash, {
      onStatus: () => {
        throw cause;
      },
    }).catch((error) => error);
    expect(error.cause).toBe(cause);
    expect(error.knownCommitment.blockHeight).toBe(9n);
    expect(c.getTransactionStatus).toHaveBeenCalledTimes(1);
  });
  it("checks known commitment identity before reads and retains it on cancellation", async () => {
    const c = client();
    await expect(
      waitForTransactionReceipt(c, hash, {
        knownCommitment: {
          transactionHash: recipient,
          networkHash,
          blockHeight: 9n,
        },
      }),
    ).rejects.toThrow("does not match");
    expect(c.getNetworkInfo).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort(Error("cancelled"));
    const error = await waitForTransactionReceipt(c, hash, {
      knownCommitment: { transactionHash: hash, networkHash, blockHeight: 9n },
      signal: controller.signal,
    }).catch((e) => e);
    expect(error.knownCommitment.blockHeight).toBe(9n);
    expect(error.cause.message).toBe("cancelled");
  });
  it("returns commitment without waiting for receipt recovery", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    c.getTransactionStatus.mockResolvedValue({
      status: "committed",
      blockHeight: 9n,
    } as never);
    expect(await waitForCommitment(c, hash)).toEqual({
      transactionHash: hash,
      networkHash,
      blockHeight: 9n,
    });
  });
  it("rejects a changed network before querying transaction evidence", async () => {
    const c = client();
    c.getNetworkInfo.mockResolvedValue({ networkHash: recipient });
    await expect(waitForTransactionReceipt(c, hash)).rejects.toBeInstanceOf(
      TransactionReceiptObservationError,
    );
    expect(c.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
describe("single-call funding", () => {
  it("waits read-only on a pending hash", async () => {
    const c = client();
    const response = await requestAirdrop(c, { recipient });
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
    expect(c.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      attemptStatus: "succeeded",
      transactionHash: hash,
      blockHeight: 9n,
    });
  });
  it("stops on pending without a hash", async () => {
    const c = client();
    c.faucet_requestAirdrop.mockResolvedValue({
      attemptStatus: "pending",
      recipient,
      rawAmount: 42n,
    } as never);
    await expect(requestAirdrop(c, { recipient })).rejects.toBeInstanceOf(
      FundingObservationError,
    );
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
    expect(c.getTransactionReceipt).not.toHaveBeenCalled();
  });
  it("does not repeat ambiguous errors and retains request context", async () => {
    const c = client();
    const cause = Error("connection lost after dispatch");
    c.faucet_requestAirdrop.mockRejectedValue(cause);
    const error = await requestAirdrop(c, {
      recipient,
      clientNonce: new Uint8Array([1]),
    }).catch((e) => e);
    expect(error.cause).toBe(cause);
    expect(error.request).toMatchObject({
      recipient,
      networkHash,
      clientNonce: new Uint8Array([1]),
    });
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
    expect(c.getTransactionReceipt).not.toHaveBeenCalled();
  });
  it("retains failed receipt commitment", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue({
      ...receipt,
      execution: { result: "fault" },
    } as TransactionReceipt);
    const error = await requestAirdrop(c, { recipient }).catch((e) => e);
    expect(error.knownCommitment.blockHeight).toBe(9n);
    expect(error.cause.receipt.execution.result).toBe("fault");
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
  });
  it("retains commitment from a terminal faucet error without another call", async () => {
    const c = client();
    const rawReceipt = {
      transactionHash: toBase58(hash),
      blockHeight: "9",
      execution: { result: "fault" },
      gasUsed: "5",
      events: [],
    };
    const cause = new NativeRpcError(
      new JsonRpcError(
        NativeRpcErrorCode.FundingAttemptStopped,
        "stopped",
        {
          kind: "fundingAttemptStopped",
          transactionHash: toBase58(hash),
          receipt: rawReceipt,
        },
        "faucet_requestAirdrop",
      ),
      "faucet_requestAirdrop",
    );
    expect(cause.decoded.classification).toBe("known");
    c.faucet_requestAirdrop.mockRejectedValue(cause);
    const error = await requestAirdrop(c, { recipient }).catch((e) => e);
    expect(error.cause).toBe(cause);
    expect(error.knownCommitment).toEqual({
      networkHash,
      transactionHash: hash,
      blockHeight: 9n,
    });
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
    expect(c.getTransactionReceipt).not.toHaveBeenCalled();
  });
  it("does not call the faucet after cancellation", async () => {
    const c = client(),
      controller = new AbortController();
    controller.abort();
    await expect(
      requestAirdrop(c, { recipient, signal: controller.signal }),
    ).rejects.toBeInstanceOf(FundingObservationError);
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });
});
describe("submission evidence", () => {
  const bytes = fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr);
  it("retains immutable signed bytes and hash before cancellation", async () => {
    const evidence = createSubmissionEvidence(bytes, networkHash),
      submit = vi.fn(),
      waitForTransactionReceipt = vi.fn(),
      controller = new AbortController();
    controller.abort(Error("cancel"));
    const error = await submitAndObserve(
      { waitForTransactionReceipt },
      evidence,
      submit,
      { signal: controller.signal },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(TransactionObservationError);
    expect(error.phase).toBe("beforeSubmission");
    expect(error.submission.signedTransaction).toEqual(bytes);
    error.submission.signedTransaction.fill(0);
    expect(error.submission.signedTransaction).toEqual(bytes);
    expect(submit).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });
  it("reconciles a malformed post-write response only by reads", async () => {
    const evidence = createSubmissionEvidence(bytes, networkHash),
      cause = new Error("malformed response"),
      submit = vi.fn().mockRejectedValue(cause),
      waitForTransactionReceipt = vi.fn().mockResolvedValue({
        ...receipt,
        transactionHash: evidence.transactionHash,
      });
    const result = await submitAndObserve(
      { waitForTransactionReceipt },
      evidence,
      submit,
    );
    expect(result.submission?.signedTransaction).toEqual(bytes);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(waitForTransactionReceipt).toHaveBeenCalledWith(
      evidence.transactionHash,
      expect.objectContaining({ expectedNetworkHash: networkHash }),
    );
  });
  it("retains both malformed submission evidence and strongest commitment if observation stops", async () => {
    const evidence = createSubmissionEvidence(bytes, networkHash),
      submitCause = { unexpected: true },
      knownCommitment = {
        networkHash,
        transactionHash: evidence.transactionHash,
        blockHeight: 9n,
      };
    const observation = new TransactionReceiptObservationError(
      evidence.transactionHash,
      knownCommitment,
      { status: "committed", blockHeight: 9n },
      Error("cancel"),
    );
    const error = await submitAndObserve(
      { waitForTransactionReceipt: vi.fn().mockRejectedValue(observation) },
      evidence,
      vi.fn().mockRejectedValue(submitCause),
    ).catch((e) => e);
    expect(error.submissionCause).toBe(submitCause);
    expect(error.cause).toBe(observation);
    expect(error.knownCommitment).toEqual(knownCommitment);
  });
});

describe("observation failure timing", () => {
  it("honors status retry hints and retains their cause on timeout", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const error = new NativeRpcError(
      new JsonRpcError(-32053, "busy", {
        kind: "overloaded",
        retryAfterMs: "5000",
      }),
      "getTransactionStatus",
      hash,
    );
    expect(error.decoded.classification).toBe("known");
    c.getTransactionStatus.mockRejectedValue(error);
    const outcome = waitForTransactionReceipt(c, hash, {
      timeoutMs: 6000,
      pollingIntervalMs: 250,
    }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(c.getTransactionStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(c.getTransactionStatus).toHaveBeenCalledTimes(2);
    expect((await outcome).cause).toBe(error);
  });
  it("does not reset status transport failures on a null receipt", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const cause = Error("status lookup lost");
    c.getTransactionStatus.mockRejectedValue(cause);
    const outcome = waitForTransactionReceipt(c, hash, {
      timeoutMs: 100,
      pollingIntervalMs: 10,
    }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(110);
    expect((await outcome).cause).toBe(cause);
  });
  it("passes the deadline signal to a queued submission", async () => {
    vi.useFakeTimers();
    const evidence = createSubmissionEvidence(
      fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr),
      networkHash,
    );
    let submissionSignal: AbortSignal | undefined;
    const submit = vi.fn((signal: AbortSignal) => {
      submissionSignal = signal;
      return new Promise<void>(() => {});
    });
    const waitForTransactionReceipt = vi.fn();
    const outcome = submitAndObserve(
      { waitForTransactionReceipt },
      evidence,
      submit,
      { timeoutMs: 10 },
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(11);
    expect((await outcome).phase).toBe("submission");
    expect(submissionSignal?.aborted).toBe(true);
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });
  it("cancels a stalled provider submission and ignores late success", async () => {
    const evidence = createSubmissionEvidence(
        fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr),
        networkHash,
      ),
      controller = new AbortController(),
      waitForTransactionReceipt = vi.fn();
    let resolve!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const outcome = submitAndObserve(
      { waitForTransactionReceipt },
      evidence,
      submit,
      { signal: controller.signal },
    ).catch((e) => e);
    controller.abort(Error("cancelled after dispatch"));
    const error = await outcome;
    expect(error.phase).toBe("submission");
    expect(error.submission.signedTransaction).toEqual(
      evidence.signedTransaction,
    );
    resolve();
    await Promise.resolve();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

it("zero submission budget is pre-dispatch evidence", async () => {
  const evidence = createSubmissionEvidence(
      fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr),
      networkHash,
    ),
    submit = vi.fn(),
    waitForTransactionReceipt = vi.fn();
  const error = await submitAndObserve(
    { waitForTransactionReceipt },
    evidence,
    submit,
    { timeoutMs: 0 },
  ).catch((e) => e);
  expect(error.phase).toBe("beforeSubmission");
  expect(submit).not.toHaveBeenCalled();
  expect(waitForTransactionReceipt).not.toHaveBeenCalled();
});
