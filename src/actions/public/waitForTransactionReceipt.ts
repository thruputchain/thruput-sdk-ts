import { toBase58 } from "../../encoding.js";
import { isThruputError, ThruputError } from "../../errors/thruputError.js";
import type { TransactionReason } from "../../errors/transaction.js";
import type { RpcClient } from "../../rpc/client.js";
import { rpcIncompatible } from "../../rpc/client.js";
import { UnsupportedRpcValue } from "../../rpc/codec.js";
import type { TransactionReceipt, TransactionStatus } from "../../types/rpc.js";
import { classifyReadError } from "../../transport/readError.js";
import { beforeDeadline, validateTimer, waitDelay } from "../deadline.js";

export interface KnownCommitment {
  readonly networkHash: Uint8Array;
  readonly transactionHash: Uint8Array;
  readonly blockHeight: bigint;
}
export interface WaitForTransactionReceiptOptions {
  signal?: AbortSignal;
  /** Verified before each observation; omission uses discovery's validated network. */
  expectedNetworkHash?: Uint8Array;
  knownCommitment?: KnownCommitment;
  /** Observed status, including optional advisory attempt diagnostics. Never retry permission. */
  onStatus?: (status: TransactionStatus) => void;
  timeoutMs?: number;
  pollingIntervalMs?: number;
}
/**
 * Observation stopped: code `transactionOutcomeUnknown`. Neither a timeout nor
 * cancellation proves that the transaction did not execute.
 */
function outcomeUnknown(
  transactionHash: Uint8Array,
  reason: TransactionReason,
  timedOut: boolean,
  cause: unknown,
  knownCommitment: KnownCommitment | undefined,
  lastStatus: TransactionStatus | undefined,
): ThruputError<"transactionOutcomeUnknown"> {
  return new ThruputError(
    "transactionOutcomeUnknown",
    timedOut
      ? `Timed out waiting for transaction ${toBase58(transactionHash)}`
      : `Could not observe transaction ${toBase58(transactionHash)}`,
    {
      context: {
        ...(knownCommitment ? { knownCommitment } : {}),
        ...(lastStatus ? { lastStatus } : {}),
      },
      ...(cause === undefined ? {} : { cause }),
      transaction: { hash: transactionHash, outcome: "unknown", reason },
    },
  );
}

/** The observation deadline. Private, so read-error handling never retries it. */
class ObservationTimeout extends Error {}

/** The reason for a timeout: the last read failure or node status, when known. */
function timeoutReason(
  lastFailure: unknown,
  lastStatus: TransactionStatus | undefined,
): TransactionReason {
  if (lastFailure !== undefined) return "disconnected";
  if (lastStatus === undefined) return "timeout";
  if (lastStatus instanceof UnsupportedRpcValue) return "statusUnknown";
  if (lastStatus.status === "unknown" || lastStatus.status === "other")
    return "statusUnknown";
  if (lastStatus.status === "recentFailure") return "recentFailure";
  return "timeout";
}

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
/** Read-only capabilities used by commitment and receipt observation. */
export type ReceiptObserver = Pick<
  RpcClient,
  | "getNetworkInfo"
  | "getTransactionReceipt"
  | "getTransactionStatus"
  | "discovery"
  | "requireMethods"
>;

/**
 * Return any committed receipt, including failed execution. Never sign or resubmit.
 * When observation stops, throws code `transactionOutcomeUnknown` with
 * `transaction.reason` set to why it stopped.
 */
export async function waitForTransactionReceipt(
  client: ReceiptObserver,
  transactionHash: Uint8Array,
  options: WaitForTransactionReceiptOptions = {},
): Promise<TransactionReceipt> {
  return (await observe(
    client,
    transactionHash,
    options,
    false,
  )) as TransactionReceipt;
}
/** Observe commitment independently of receipt availability or execution success. */
export async function waitForCommitment(
  client: ReceiptObserver,
  transactionHash: Uint8Array,
  options: WaitForTransactionReceiptOptions = {},
): Promise<KnownCommitment> {
  return (await observe(
    client,
    transactionHash,
    options,
    true,
  )) as KnownCommitment;
}
// Status evidence includes extensible values at arbitrary nested schema positions.
// structuredClone alone drops their UnsupportedRpcValue class identity.
function snapshotStatus(status: TransactionStatus): TransactionStatus {
  const copy = (value: unknown): unknown => {
    if (value instanceof UnsupportedRpcValue)
      return new UnsupportedRpcValue(structuredClone(value.raw));
    if (Array.isArray(value)) return value.map(copy);
    if (ArrayBuffer.isView(value)) return structuredClone(value);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, copy(entry)]),
      );
    return value;
  };
  return copy(status) as TransactionStatus;
}

async function observe(
  client: ReceiptObserver,
  hash: Uint8Array,
  options: WaitForTransactionReceiptOptions,
  commitmentOnly: boolean,
): Promise<TransactionReceipt | KnownCommitment> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const interval = options.pollingIntervalMs ?? 250;
  validateTimer(timeoutMs, "timeoutMs");
  validateTimer(interval, "pollingIntervalMs");
  const transactionHash = new Uint8Array(hash);
  const networkHash = new Uint8Array(
    options.expectedNetworkHash ?? client.discovery.network.networkHash,
  );
  if (transactionHash.length !== 32 || networkHash.length !== 32)
    throw new RangeError(
      "Transaction and network hashes must contain 32 bytes",
    );
  let commitment: KnownCommitment | undefined;
  let lastStatus: TransactionStatus | undefined;
  if (options.knownCommitment) {
    const known = options.knownCommitment;
    if (
      !equal(known.transactionHash, transactionHash) ||
      !equal(known.networkHash, networkHash) ||
      typeof known.blockHeight !== "bigint" ||
      known.blockHeight < 0n ||
      known.blockHeight > 9223372036854775807n
    )
      throw rpcIncompatible(
        "commitment",
        "Known commitment does not match the transaction/network context",
      );
    commitment = {
      transactionHash: transactionHash.slice(),
      networkHash: networkHash.slice(),
      blockHeight: known.blockHeight,
    };
    lastStatus = { status: "committed", blockHeight: known.blockHeight };
  }
  client.requireMethods([
    "getNetworkInfo",
    "getTransactionReceipt",
    "getTransactionStatus",
  ]);
  const deadline = performance.now() + timeoutMs;
  let lastFailure: unknown;
  let failures = 0;
  let timedOut = false;
  // Set where the reason is known at the throw site; other failures are classified below.
  let stopReason: TransactionReason | undefined;
  const stop = (reason: TransactionReason, error: unknown) => {
    stopReason = reason;
    return error;
  };
  const timeout = () => {
    timedOut = true;
    return new ObservationTimeout("Transaction observation timed out");
  };
  const run = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    beforeDeadline(operation, deadline, options.signal, timeout);
  const retain = (blockHeight: bigint) => {
    if (commitment && commitment.blockHeight !== blockHeight)
      throw stop(
        "commitmentConflict",
        rpcIncompatible(
          "commitment",
          "Conflicting commitment heights for the same transaction",
        ),
      );
    commitment = {
      transactionHash: transactionHash.slice(),
      networkHash: networkHash.slice(),
      blockHeight,
    };
    lastStatus = { status: "committed", blockHeight };
  };
  try {
    while (true) {
      let retryAfterMs: bigint | undefined;
      let networkVerified = false;
      let failed = false;
      try {
        const network = await run((signal) =>
          client.getNetworkInfo({}, { signal }),
        );
        if (!equal(network.networkHash, networkHash))
          throw stop(
            "networkChanged",
            rpcIncompatible("network", "Observation endpoint network changed"),
          );
        networkVerified = true;
        if (commitmentOnly && commitment) return structuredClone(commitment);
        const receipt = await run((signal) =>
          client.getTransactionReceipt({ transactionHash }, { signal }),
        );
        if (receipt) {
          retain(receipt.blockHeight);
          return commitmentOnly ? structuredClone(commitment!) : receipt;
        }
      } catch (cause) {
        // An abort reason can be another transaction's error; read nothing from it.
        if (cause instanceof ObservationTimeout || options.signal?.aborted)
          throw cause;
        lastFailure = cause;
        failed = true;
        if (isThruputError(cause, "nativeRpcError") && cause.context.data) {
          const data = cause.context.data;
          if (data.kind === "backendDataInvalid" && data.observation) {
            retain(data.observation.blockHeight);
            if (commitmentOnly) return structuredClone(commitment!);
          }
          if ("retryAfterMs" in data) retryAfterMs = data.retryAfterMs;
        }
        if (
          options.signal?.aborted ||
          classifyReadError(cause, options) !== "transient"
        )
          throw cause;
      }
      // Status failures cannot erase a previously validated commitment.
      let observedStatus: TransactionStatus | undefined;
      if (networkVerified)
        try {
          const status = await run((signal) =>
            client.getTransactionStatus({ transactionHash }, { signal }),
          );
          if (
            !(status instanceof UnsupportedRpcValue) &&
            status.status === "committed"
          )
            retain(status.blockHeight);
          else if (!commitment) lastStatus = snapshotStatus(status);
          observedStatus = status;
        } catch (cause) {
          if (
            cause instanceof ObservationTimeout ||
            isThruputError(cause, "rpcIncompatible") ||
            isThruputError(cause, "rpcValueInvalid") ||
            isThruputError(cause, "rpcRequestInvalid") ||
            classifyReadError(cause, options) === "permanent"
          )
            throw cause;
          options.signal?.throwIfAborted();
          lastFailure = cause;
          failed = true;
          if (
            isThruputError(cause, "nativeRpcError") &&
            cause.context.data &&
            "retryAfterMs" in cause.context.data
          ) {
            const hint = cause.context.data.retryAfterMs;
            if (
              hint !== undefined &&
              (retryAfterMs === undefined || hint > retryAfterMs)
            )
              retryAfterMs = hint;
          }
        }
      if (observedStatus !== undefined) options.onStatus?.(observedStatus);
      if (failed) failures++;
      else {
        failures = 0;
        lastFailure = undefined;
      }
      if (commitmentOnly && commitment) return structuredClone(commitment);
      const backoff = failures
        ? Math.min(
            5000,
            Math.max(1, interval) * 2 ** Math.min(failures - 1, 8),
          ) *
          (0.5 + Math.random() / 2)
        : interval;
      const remaining = deadline - performance.now();
      if (
        retryAfterMs !== undefined &&
        retryAfterMs > BigInt(Math.max(0, Math.floor(remaining)))
      )
        throw timeout();
      const delay = Math.max(backoff, Number(retryAfterMs ?? 0n));
      await run((signal) =>
        waitDelay(Math.min(delay, Math.max(0, remaining)), signal),
      );
    }
  } catch (cause) {
    const reason: TransactionReason = options.signal?.aborted
      ? "cancelled"
      : timedOut
        ? timeoutReason(lastFailure, lastStatus)
        : (stopReason ?? "observationFailed");
    throw outcomeUnknown(
      transactionHash,
      reason,
      timedOut && reason !== "cancelled",
      cause instanceof ObservationTimeout ? lastFailure : cause,
      commitment && structuredClone(commitment),
      lastStatus,
    );
  }
}
