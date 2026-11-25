import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../../rpc/client.js";
import { rpcValueInvalid, UnsupportedRpcValue } from "../../rpc/codec.js";
import { nativeRpcError } from "../../rpc/errorReader.js";
import { rpcError } from "../../transport/errors.js";
import { ThruputError } from "../../errors/thruputError.js";
import {
  waitForTransactionReceipt,
  waitForCommitment,
} from "./waitForTransactionReceipt.js";
import { requestAirdrop } from "./requestAirdrop.js";
import {
  assertTransactionSuccess,
  createSubmissionEvidence,
  submitAndObserve,
} from "../../wallet/execution.js";
import type { TransactionReceipt } from "../../types/rpc.js";
import vectors from "../../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x, toHex0x } from "../hex.js";
import { parseThruputError } from "../../errors/serialize.js";
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
  it.each([
    ["Uint8Array", true],
    ["Buffer", true],
    ["Buffer", false],
  ] as const)(
    "snapshots %s observation hashes before network lookup (explicit network: %s)",
    async (kind, explicitNetwork) => {
      const copy = (value: Uint8Array) =>
        kind === "Buffer"
          ? Buffer.concat([
              Buffer.from([99]),
              Buffer.from(value),
              Buffer.from([99]),
            ]).subarray(1, value.length + 1)
          : new Uint8Array(value);
      const c = client();
      const inputHash = copy(hash),
        inputNetwork = copy(networkHash);
      let release!: () => void;
      c.getNetworkInfo.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { networkHash };
      });
      Object.assign(c.discovery.network, { networkHash: inputNetwork });
      const cause = rpcValueInvalid("getTransactionReceipt", {
        malformed: true,
      });
      c.getTransactionReceipt.mockRejectedValue(cause);
      const outcome = waitForTransactionReceipt(c, inputHash, {
        ...(explicitNetwork ? { expectedNetworkHash: inputNetwork } : {}),
        knownCommitment: {
          transactionHash: inputHash,
          networkHash: inputNetwork,
          blockHeight: 9n,
        },
      }).catch((error) => error);
      inputHash.fill(8);
      inputNetwork.fill(8);
      release();
      const error = await outcome;
      expect(error).toMatchObject({ code: "transactionOutcomeUnknown" });
      expect(error.cause).toBe(cause);
      expect(error.transaction.hash).toEqual(hash);
      expect(error.context.knownCommitment).toEqual({
        transactionHash: hash,
        networkHash,
        blockHeight: 9n,
      });
      expect(c.getTransactionReceipt).toHaveBeenCalledWith(
        { transactionHash: hash },
        expect.anything(),
      );
      expect(c.getTransactionStatus).not.toHaveBeenCalled();
    },
  );
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
    expect(caught).toMatchObject({ code: "transactionFailed" });
    expect((caught as ThruputError).shortMessage).toBe(
      `Transaction ${toBase58(hash)} execution failed (abort)`,
    );
    expect((caught as ThruputError).transaction).toMatchObject({
      outcome: "failed",
      reason: "aborted",
      receipt: failed,
    });
  });
  it("does not interpret an unknown execution variant", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue({
      ...receipt,
      execution: new UnsupportedRpcValue({ result: "future", newPayload: 7 }),
    });
    const result = await waitForTransactionReceipt(c, hash);
    expect(() => assertTransactionSuccess(result)).toThrow(
      expect.objectContaining({ code: "transactionOutcomeUnsupported" }),
    );
    let error!: ThruputError;
    try {
      assertTransactionSuccess(result);
    } catch (caught) {
      error = caught as ThruputError;
    }
    expect(error.shortMessage).toBe(
      `Transaction ${toBase58(hash)} has an unsupported execution outcome`,
    );
    expect(error.shortMessage).not.toMatch(/failed/);
    expect(error.transaction).toMatchObject({
      outcome: "unknown",
      reason: "outcomeUnsupported",
      receipt: result,
    });
  });
  it.each([
    // An UnsupportedRpcValue from another package copy, such as the CJS build.
    [
      "a foreign unsupported value",
      { unsupported: true, raw: { result: "x" } },
    ],
    ["an unknown result", { result: "future" }],
  ])("treats %s as an unsupported outcome, not a failure", (_, execution) => {
    const result = { ...receipt, execution } as unknown as TransactionReceipt;
    expect(() => assertTransactionSuccess(result)).toThrow(
      expect.objectContaining({
        code: "transactionOutcomeUnsupported",
        transaction: expect.objectContaining({
          outcome: "unknown",
          reason: "outcomeUnsupported",
        }),
      }),
    );
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
    expect(error.context.knownCommitment).toEqual({
      transactionHash: hash,
      networkHash,
      blockHeight: 9n,
    });
    expect(error.context.lastStatus).toEqual({
      status: "committed",
      blockHeight: 9n,
    });
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
    expect(error.context.lastStatus).toEqual({
      status: "retry",
      error: { source: "executor", code: 3 },
      recentFailure: { attemptBlockHeight: 7n, cause: { kind: "other" } },
    });
    expect(error.context.knownCommitment).toBeUndefined();
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
    expect(error.context.lastStatus.recentFailure.cause).toBeInstanceOf(
      UnsupportedRpcValue,
    );
    expect(error.context.lastStatus.recentFailure.cause.raw).toEqual({
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
    expect(error.context.lastStatus).toEqual({
      status: "committed",
      blockHeight: 9n,
    });
    expect(error.context.knownCommitment.blockHeight).toBe(9n);
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });
  it("stops on malformed status rather than polling until timeout", async () => {
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const cause = rpcValueInvalid("status", {
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
    expect(error.context.knownCommitment.blockHeight).toBe(9n);
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
    expect(error.context.knownCommitment.blockHeight).toBe(9n);
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
    await expect(waitForTransactionReceipt(c, hash)).rejects.toMatchObject({
      code: "transactionOutcomeUnknown",
    });
    expect(c.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
describe("single-call funding", () => {
  it.each([
    ["Uint8Array", true],
    ["Buffer", true],
    ["Buffer", false],
  ] as const)(
    "snapshots %s funding inputs before awaiting network verification (explicit network: %s)",
    async (kind, explicitNetwork) => {
      const copy = (value: Uint8Array) =>
        kind === "Buffer"
          ? Buffer.concat([
              Buffer.from([99]),
              Buffer.from(value),
              Buffer.from([99]),
            ]).subarray(1, value.length + 1)
          : new Uint8Array(value);
      const inputRecipient = copy(recipient),
        inputNonce = copy(new Uint8Array([4, 5])),
        inputNetwork = copy(networkHash);
      const c = client();
      let release!: () => void;
      c.getNetworkInfo.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { networkHash };
      });
      Object.assign(c.discovery.network, { networkHash: inputNetwork });
      const cause = Error("ambiguous funding response");
      c.faucet_requestAirdrop.mockRejectedValue(cause);
      const outcome = requestAirdrop(c, {
        recipient: inputRecipient,
        clientNonce: inputNonce,
        ...(explicitNetwork ? { expectedNetworkHash: inputNetwork } : {}),
      }).catch((error) => error);
      inputRecipient.fill(8);
      inputNonce.fill(8);
      inputNetwork.fill(8);
      release();
      const error = await outcome;
      expect(error).toMatchObject({ code: "fundingStopped" });
      expect(error.cause).toBe(cause);
      expect(error.context.request).toEqual({
        recipient,
        clientNonce: new Uint8Array([4, 5]),
        networkHash,
      });
      expect(c.faucet_requestAirdrop).toHaveBeenCalledExactlyOnceWith(
        { recipient, clientNonce: new Uint8Array([4, 5]) },
        expect.anything(),
      );
      expect(c.getTransactionReceipt).not.toHaveBeenCalled();
    },
  );
  it("retains commitment from succeeded funding with unknown execution without another write", async () => {
    const c = client();
    const execution = new UnsupportedRpcValue({
      result: "future",
      newPayload: 7,
    });
    const response = {
      attemptStatus: "succeeded",
      recipient,
      rawAmount: 42n,
      transactionHash: Buffer.from(hash),
      blockHeight: 9n,
      execution,
    };
    c.faucet_requestAirdrop.mockResolvedValue(response as never);
    const error = await requestAirdrop(c, { recipient }).catch(
      (error) => error,
    );
    expect(error).toMatchObject({ code: "fundingStopped" });
    expect(error.cause.context.value).toEqual(execution);
    expect(error.context.lastResponse).toEqual({
      ...response,
      transactionHash: hash,
    });
    expect(error.transaction).toMatchObject({
      outcome: "unknown",
      reason: "outcomeUnsupported",
    });
    expect(error.transaction.hash).toEqual(hash);
    expect(error.context.knownCommitment).toEqual({
      networkHash,
      transactionHash: hash,
      blockHeight: 9n,
    });
    response.transactionHash.fill(8);
    expect(error.context.knownCommitment.transactionHash).toEqual(hash);
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
    expect(c.getTransactionReceipt).not.toHaveBeenCalled();
    expect(c.getTransactionStatus).not.toHaveBeenCalled();
  });
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
    await expect(requestAirdrop(c, { recipient })).rejects.toMatchObject({
      code: "fundingStopped",
    });
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
    expect(error.context.request).toMatchObject({
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
    expect(error.context.knownCommitment.blockHeight).toBe(9n);
    expect(error.cause.transaction.receipt.execution.result).toBe("fault");
    expect(error.transaction).toMatchObject({
      outcome: "failed",
      reason: "faulted",
    });
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
  });
  it("reports no transaction facts when a transient faucet error has no hash", async () => {
    const c = client();
    const cause = nativeRpcError(
      rpcError(-32053, "busy", { kind: "overloaded" }).context,
      "faucet_requestAirdrop",
    );
    expect(cause.context.kind).toBe("overloaded");
    c.faucet_requestAirdrop.mockRejectedValue(cause);
    const error = await requestAirdrop(c, { recipient }).catch((e) => e);
    expect(error).toMatchObject({ code: "fundingStopped", cause });
    expect(error.transaction).toBeUndefined();
    expect(error.context.request.clientNonce).toBeInstanceOf(Uint8Array);
    expect(c.faucet_requestAirdrop).toHaveBeenCalledTimes(1);
  });

  it("reports a stopped attempt with a successful receipt as nodeRejected", async () => {
    const c = client();
    c.faucet_requestAirdrop.mockRejectedValue(
      nativeRpcError(
        rpcError(
          NativeRpcErrorCode.FundingAttemptStopped,
          "stopped",
          {
            kind: "fundingAttemptStopped",
            transactionHash: toBase58(hash),
            receipt: {
              transactionHash: toBase58(hash),
              blockHeight: "9",
              execution: { result: "return", returnData: "0x" },
              gasUsed: "5",
              events: [],
            },
          },
          "faucet_requestAirdrop",
        ).context,
        "faucet_requestAirdrop",
      ),
    );
    const error = await requestAirdrop(c, { recipient }).catch((e) => e);
    expect(error.cause.context.kind).toBe("fundingAttemptStopped");
    expect(error).toMatchObject({
      code: "fundingStopped",
      transaction: { outcome: "succeeded", reason: "nodeRejected" },
    });
  });

  it("takes no transaction evidence from an abort reason", async () => {
    const c = client();
    const previous = new ThruputError("transactionFailed", "Earlier failure", {
      transaction: {
        hash: new Uint8Array(32).fill(9),
        outcome: "failed",
        reason: "aborted",
      },
    });
    const error = await requestAirdrop(c, {
      recipient,
      signal: AbortSignal.abort(previous),
    }).catch((e) => e);
    expect(error).toMatchObject({ code: "fundingStopped", cause: previous });
    expect(error.transaction).toBeUndefined();
    expect(error.context.knownCommitment).toBeUndefined();
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });

  it("keeps verified signed bytes from a stopped faucet attempt", async () => {
    const c = client();
    const signedBytes = fromHex0x(
      "0x" + vectors.signing[0]!.signed_transaction_xdr,
    );
    const signedHash = createSubmissionEvidence(
      signedBytes,
      networkHash,
    ).transactionHash;
    const cause = nativeRpcError(
      rpcError(
        NativeRpcErrorCode.FundingAttemptStopped,
        "stopped",
        {
          kind: "fundingAttemptStopped",
          transactionHash: toBase58(signedHash),
          signedTransaction: toHex0x(signedBytes),
        },
        "faucet_requestAirdrop",
      ).context,
      "faucet_requestAirdrop",
    );
    expect(cause.context.kind).toBe("fundingAttemptStopped");
    c.faucet_requestAirdrop.mockRejectedValue(cause);
    const error = await requestAirdrop(c, { recipient }).catch((e) => e);
    expect(error.transaction).toMatchObject({
      outcome: "unknown",
      reason: "nodeRejected",
    });
    expect(error.transaction.submission.signedTransaction).toEqual(signedBytes);
    const restored = parseThruputError(JSON.parse(JSON.stringify(error)));
    expect(restored.transaction?.submission?.transactionHash).toEqual(
      signedHash,
    );
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
    const cause = nativeRpcError(
      rpcError(
        NativeRpcErrorCode.FundingAttemptStopped,
        "stopped",
        {
          kind: "fundingAttemptStopped",
          transactionHash: toBase58(hash),
          receipt: rawReceipt,
        },
        "faucet_requestAirdrop",
      ).context,
      "faucet_requestAirdrop",
    );
    expect(cause.context.kind).not.toBe("unrecognized");
    c.faucet_requestAirdrop.mockRejectedValue(cause);
    const error = await requestAirdrop(c, { recipient }).catch((e) => e);
    expect(error.cause).toBe(cause);
    expect(error.context.knownCommitment).toEqual({
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
    ).rejects.toMatchObject({ code: "fundingStopped" });
    expect(c.faucet_requestAirdrop).not.toHaveBeenCalled();
  });
});
describe("submission evidence", () => {
  const bytes = fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr);
  it.each(["Uint8Array", "Buffer"])(
    "isolates %s input and accessor mutations from retained submission evidence",
    (kind) => {
      const copy = (value: Uint8Array) =>
        kind === "Buffer"
          ? Buffer.concat([
              Buffer.from([99]),
              Buffer.from(value),
              Buffer.from([99]),
            ]).subarray(1, value.length + 1)
          : new Uint8Array(value);
      const input = copy(bytes),
        network = copy(networkHash);
      const evidence = createSubmissionEvidence(input, network);
      const expectedHash = new Uint8Array(evidence.transactionHash);
      input.fill(0);
      network.fill(0);
      expect(evidence.signedTransaction).toEqual(bytes);
      expect(evidence.networkHash).toEqual(networkHash);
      for (const field of [
        "signedTransaction",
        "transactionHash",
        "networkHash",
      ] as const) {
        const exposed = evidence[field];
        expect(exposed.constructor).toBe(Uint8Array);
        exposed.fill(0);
      }
      expect(evidence.signedTransaction).toEqual(bytes);
      expect(evidence.networkHash).toEqual(networkHash);
      expect(evidence.transactionHash).toEqual(expectedHash);
    },
  );
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
    expect(error).toMatchObject({
      code: "transactionNotSubmitted",
      transaction: { outcome: "notSubmitted", reason: "cancelled" },
    });
    expect(error.transaction.submission.signedTransaction).toEqual(bytes);
    error.transaction.submission.signedTransaction.fill(0);
    expect(error.transaction.submission.signedTransaction).toEqual(bytes);
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
    const observation = new ThruputError(
      "transactionOutcomeUnknown",
      "Could not observe transaction",
      {
        context: {
          knownCommitment,
          lastStatus: { status: "committed", blockHeight: 9n },
        },
        cause: Error("cancel"),
        transaction: {
          hash: evidence.transactionHash,
          outcome: "unknown",
          reason: "cancelled",
        },
      },
    );
    const error = await submitAndObserve(
      { waitForTransactionReceipt: vi.fn().mockRejectedValue(observation) },
      evidence,
      vi.fn().mockRejectedValue(submitCause),
    ).catch((e) => e);
    expect(error.context.submissionError).toEqual(submitCause);
    expect(error.cause).toBe(observation.cause);
    expect(error.context.knownCommitment).toEqual(knownCommitment);
    expect(error.transaction).toMatchObject({
      outcome: "unknown",
      reason: "cancelled",
      submission: { transactionHash: evidence.transactionHash },
    });
  });
});

describe("observation failure timing", () => {
  it("honors status retry hints and retains their cause on timeout", async () => {
    vi.useFakeTimers();
    const c = client();
    c.getTransactionReceipt.mockResolvedValue(null);
    const error = nativeRpcError(
      rpcError(-32053, "busy", {
        kind: "overloaded",
        retryAfterMs: "5000",
      }).context,
      "getTransactionStatus",
      hash,
    );
    expect(error.context.kind).not.toBe("unrecognized");
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
    expect((await outcome).transaction.outcome).toBe("unknown");
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
    expect(error.transaction.outcome).toBe("unknown");
    expect(error.transaction.submission.signedTransaction).toEqual(
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
  expect(error.transaction.outcome).toBe("notSubmitted");
  expect(submit).not.toHaveBeenCalled();
  expect(waitForTransactionReceipt).not.toHaveBeenCalled();
});
