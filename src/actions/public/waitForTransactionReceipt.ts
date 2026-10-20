import { toBase58 } from "../../encoding.js";
import type { RpcClient } from "../../rpc/client.js";
import { RpcCompatibilityError } from "../../rpc/client.js";
import { NativeRpcError } from "../../rpc/errorReader.js";
import {
  UnsupportedRpcValue,
  RpcDecodingError,
  RpcRequestValidationError,
} from "../../rpc/codec.js";
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
/** Observation stopped; neither timeout nor cancellation proves nonexecution. */
export class TransactionReceiptObservationError extends Error {
  constructor(
    readonly transactionHash: Uint8Array,
    readonly knownCommitment: KnownCommitment | undefined,
    readonly lastStatus: TransactionStatus | undefined,
    cause: unknown,
  ) {
    super(`Could not observe transaction ${toBase58(transactionHash)}`, {
      cause,
    });
    this.name = "TransactionReceiptObservationError";
  }
}
export class TransactionReceiptTimeoutError extends TransactionReceiptObservationError {
  constructor(
    transactionHash: Uint8Array,
    knownCommitment: KnownCommitment | undefined,
    lastStatus: TransactionStatus | undefined,
    cause?: unknown,
  ) {
    super(transactionHash, knownCommitment, lastStatus, cause);
    this.name = "TransactionReceiptTimeoutError";
    this.message = `Timed out waiting for transaction ${toBase58(transactionHash)}`;
  }
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

/** Return any committed receipt, including failed execution. Never sign or resubmit. */
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
  const transactionHash = hash.slice();
  const networkHash = (
    options.expectedNetworkHash ?? client.discovery.network.networkHash
  ).slice();
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
      throw new RpcCompatibilityError(
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
  const timeout = () =>
    new TransactionReceiptTimeoutError(
      transactionHash.slice(),
      commitment && structuredClone(commitment),
      lastStatus,
      lastFailure,
    );
  const run = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    beforeDeadline(operation, deadline, options.signal, timeout);
  const retain = (blockHeight: bigint) => {
    if (commitment && commitment.blockHeight !== blockHeight)
      throw new RpcCompatibilityError(
        "Conflicting commitment heights for the same transaction",
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
          throw new RpcCompatibilityError(
            "Observation endpoint network changed",
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
        lastFailure = cause;
        failed = true;
        if (
          cause instanceof NativeRpcError &&
          cause.decoded.classification === "known"
        ) {
          const data = cause.decoded.data;
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
            cause instanceof RpcCompatibilityError ||
            cause instanceof RpcDecodingError ||
            cause instanceof RpcRequestValidationError ||
            classifyReadError(cause, options) === "permanent"
          )
            throw cause;
          options.signal?.throwIfAborted();
          lastFailure = cause;
          failed = true;
          if (
            cause instanceof NativeRpcError &&
            cause.decoded.classification === "known" &&
            "retryAfterMs" in cause.decoded.data
          ) {
            const hint = cause.decoded.data.retryAfterMs;
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
    if (cause instanceof TransactionReceiptTimeoutError) throw cause;
    throw new TransactionReceiptObservationError(
      transactionHash,
      commitment && structuredClone(commitment),
      lastStatus,
      cause,
    );
  }
}
