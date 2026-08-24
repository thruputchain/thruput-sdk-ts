import type { ContractAddress, SHA256Hash } from "@groundhogchain/protocol";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import {
  GroundhogRpcErrorCode,
  HttpResponseError,
  JsonRpcError,
} from "../../transport/http.js";
import type {
  AirdropAttemptRequest,
  AirdropPending,
  AirdropResponse,
  AirdropSucceeded,
  AirdropExecutionStatus,
} from "../../types/rpc.js";
import { addressFromHex, hashFromHex, toHex0x } from "../hex.js";

const maxTimerDelayMs = 2_147_483_647;
const defaultTimeoutMs = 60_000;
const transientRetryDelayMs = 250;

/** Options for the high-level {@link requestAirdrop} action. */
export interface RequestAirdropOptions {
  /** Address to fund. */
  readonly recipient: ContractAddress;

  /** Existing 1-32 byte idempotency nonce, or 16 random bytes when omitted. */
  readonly clientNonce?: Uint8Array;

  /** Maximum time to wait for success. Defaults to 60 seconds. */
  readonly timeoutMs?: number;

  /** Stop waiting when this signal is aborted. */
  readonly signal?: AbortSignal;
}

/** Error thrown when an airdrop result does not match the RPC contract. */
export class InvalidAirdropResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidAirdropResponseError";
  }
}

/** Perform one `groundhog_requestAirdrop` attempt without polling. */
export async function requestAirdropAttempt(
  transport: Transport,
  request: AirdropAttemptRequest,
  options: TransportRequestOptions = {},
): Promise<AirdropResponse> {
  validateRequest(request);
  const recipient = new Uint8Array(request.recipient) as ContractAddress;
  const clientNonce = new Uint8Array(request.clientNonce);
  const result = await transport.request<unknown>(
    "groundhog_requestAirdrop",
    [
      {
        recipient: toHex0x(recipient),
        clientNonce: toHex0x(clientNonce),
      },
    ],
    options,
  );
  return parseResponse(result, recipient);
}

/**
 * Request an airdrop and wait for it to commit.
 *
 * The action generates one nonce when omitted and reuses it for every pending
 * poll and ambiguous retry. A timeout or abort stops waiting but does not prove
 * that the airdrop failed.
 */
export async function requestAirdrop(
  transport: Transport,
  options: RequestAirdropOptions,
): Promise<AirdropSucceeded> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  validateTimer(timeoutMs, "timeoutMs");
  const request: AirdropAttemptRequest = {
    recipient: new Uint8Array(options.recipient) as ContractAddress,
    clientNonce:
      options.clientNonce === undefined
        ? crypto.getRandomValues(new Uint8Array(16))
        : new Uint8Array(options.clientNonce),
  };
  validateRequest(request);

  const deadline = performance.now() + timeoutMs;
  const timeoutError = () =>
    new Error(`Timed out waiting for airdrop to ${toHex0x(request.recipient)}`);

  while (true) {
    let response: AirdropResponse;
    try {
      response = await beforeDeadline(
        (signal) => requestAirdropAttempt(transport, request, { signal }),
        deadline,
        options.signal,
        timeoutError,
      );
    } catch (cause) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      if (!isRetryableFailure(cause)) throw cause;
      await sleepBeforeDeadline(
        transientRetryDelayMs,
        deadline,
        options.signal,
        timeoutError,
      );
      continue;
    }

    if (response.attemptStatus === "succeeded") return response;
    await sleepBeforeDeadline(
      response.retryAfterSeconds * 1_000,
      deadline,
      options.signal,
      timeoutError,
    );
  }
}

function validateRequest(request: AirdropAttemptRequest): void {
  if (request.recipient.length !== 32) {
    throw new RangeError("recipient must be 32 bytes");
  }
  if (request.clientNonce.length < 1 || request.clientNonce.length > 32) {
    throw new RangeError("clientNonce must contain between 1 and 32 bytes");
  }
}

function parseResponse(
  result: unknown,
  expectedRecipient: ContractAddress,
): AirdropResponse {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new InvalidAirdropResponseError("Invalid airdrop response");
  }
  const raw = result as Record<string, unknown>;

  try {
    const recipient = parseRecipient(raw.recipient, expectedRecipient);
    const rawAmount = parseUnsignedDecimal(raw.rawAmount, "rawAmount");
    if (raw.attemptStatus === "pending") {
      const pending: AirdropPending = {
        attemptStatus: "pending",
        recipient,
        rawAmount,
        retryAfterSeconds: parseRetryAfter(raw.retryAfterSeconds),
      };
      if (raw.txHash !== undefined && raw.txHash !== null) {
        pending.txHash = parseHash(raw.txHash, "txHash");
      }
      return pending;
    }
    if (raw.attemptStatus === "succeeded") {
      return {
        attemptStatus: "succeeded",
        recipient,
        rawAmount,
        txHash: parseHash(raw.txHash, "txHash"),
        height: parseInteger(raw.height, "height"),
        status: parseExecutionStatus(raw.status),
      };
    }
    throw new Error("expected attemptStatus");
  } catch (cause) {
    if (cause instanceof InvalidAirdropResponseError) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new InvalidAirdropResponseError(`Invalid airdrop response${detail}`, {
      cause,
    });
  }
}

function parseRecipient(
  value: unknown,
  expected: ContractAddress,
): ContractAddress {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new Error("expected canonical recipient");
  }
  const recipient = addressFromHex(value);
  if (!bytesEqual(recipient, expected)) {
    throw new Error("response recipient does not match request");
  }
  return recipient;
}

function parseHash(value: unknown, field: string): SHA256Hash {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new Error(`expected canonical ${field}`);
  }
  return hashFromHex(value);
}

function parseUnsignedDecimal(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`expected decimal ${field}`);
  }
  return BigInt(value);
}

function parseInteger(value: unknown, field: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`expected non-negative integer ${field}`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`expected non-negative integer ${field}`);
}

function parseRetryAfter(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("expected retryAfterSeconds");
  }
  return value as number;
}

function parseExecutionStatus(value: unknown): AirdropExecutionStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected status");
  }
  const status = value as Record<string, unknown>;
  switch (status.result) {
    case "ok":
    case "nonDeterministicError":
    case "failedGasSponsorship":
    case "other":
      return { result: status.result };
    case "reverted":
      if (
        status.message !== undefined &&
        status.message !== null &&
        typeof status.message !== "string"
      ) {
        throw new Error("expected status.message");
      }
      return status.message === undefined
        ? { result: "reverted" }
        : { result: "reverted", message: status.message };
    case "deterministicError":
      if (typeof status.kind !== "string") {
        throw new Error("expected status.kind");
      }
      return { result: "deterministicError", kind: status.kind };
    default:
      throw new Error("expected status.result");
  }
}

function isRetryableFailure(cause: unknown): boolean {
  if (cause instanceof InvalidAirdropResponseError) return false;
  if (cause instanceof HttpResponseError) {
    return [408, 500, 502, 503, 504].includes(cause.status);
  }
  if (cause instanceof JsonRpcError) {
    return (
      cause.code === GroundhogRpcErrorCode.BackendUnavailable ||
      cause.code === GroundhogRpcErrorCode.BackendTimeout ||
      cause.code === GroundhogRpcErrorCode.Overloaded
    );
  }
  return true;
}

async function beforeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadline: number,
  signal: AbortSignal | undefined,
  timeoutError: () => Error,
): Promise<T> {
  throwIfAborted(signal);
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) throw timeoutError();

  return new Promise<T>((resolve, reject) => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const cause = timeoutError();
      abort.abort(cause);
      settle(reject, cause);
    }, Math.ceil(remainingMs));
    const onAbort = () => {
      const cause = abortReason(signal);
      abort.abort(cause);
      settle(reject, cause);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = <TValue>(
      callback: (value: TValue) => void,
      value: TValue,
    ) => {
      cleanup();
      callback(value);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    operation(abort.signal).then(
      (value) => settle(resolve, value),
      (cause) => settle(reject, cause),
    );
  });
}

async function sleepBeforeDeadline(
  requestedMs: number,
  deadline: number,
  signal: AbortSignal | undefined,
  timeoutError: () => Error,
): Promise<void> {
  throwIfAborted(signal);
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) throw timeoutError();
  const delayMs = Math.min(requestedMs, remainingMs, maxTimerDelayMs);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => settle(resolve), Math.ceil(delayMs));
    const onAbort = () => settle(reject, abortReason(signal));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = <T>(callback: (value: T) => void, value?: T) => {
      cleanup();
      callback(value as T);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | undefined): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  return Object.assign(new Error("The operation was aborted"), {
    name: "AbortError",
  });
}

function validateTimer(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > maxTimerDelayMs) {
    throw new RangeError(`${name} must be between 0 and ${maxTimerDelayMs}`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
