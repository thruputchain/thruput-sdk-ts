import type { SHA256Hash } from "@groundhogchain/protocol";
import { ExecResult } from "@groundhogchain/protocol";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { TransactionReceipt, ExecutionStatus } from "../../types/rpc.js";
import { parseEmittedEvent } from "../emittedEvent.js";
import { toHex0x, hashFromHex, fromHex0x } from "../hex.js";

interface RawExecStatus {
  result: string;
}

interface RawTransactionReceipt {
  txHash: string;
  height: number | string;
  status: unknown;
  events: unknown[];
  returnData?: string | null;
  abortData?: string | null;
  gasUsed: number | string;
}

const execStatusToResult: Record<string, ExecResult> = {
  ok: ExecResult.ExecResultOK,
  reverted: ExecResult.ExecResultTxRootFrameReverted,
  deterministicError: ExecResult.ExecResultTxDeterministicError,
  nonDeterministicError: ExecResult.ExecResultTxNonDeterministicError,
  failedGasSponsorship: ExecResult.ExecResultFailedGasSponsorship,
};

/** Error thrown when a transaction receipt does not match the RPC contract. */
export class InvalidTransactionReceiptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidTransactionReceiptError";
  }
}

function parseExecResult(status: unknown): ExecResult {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new InvalidTransactionReceiptError(
      "Invalid transaction receipt response: expected status",
    );
  }
  const raw = status as RawExecStatus;
  if (typeof raw.result !== "string") {
    throw new InvalidTransactionReceiptError(
      "Invalid transaction receipt response: expected status.result",
    );
  }
  const mapped = execStatusToResult[raw.result];
  if (mapped !== undefined) return mapped;
  return ExecResult.ExecResultUnrecoverable;
}

function parseExecutionStatus(value: unknown): ExecutionStatus {
  const raw = value as Record<string, unknown>;
  switch (raw.result) {
    case "ok":
    case "nonDeterministicError":
    case "failedGasSponsorship":
      return { result: raw.result };
    case "deterministicError":
      if (typeof raw.kind !== "string")
        throw new InvalidTransactionReceiptError(
          "Invalid transaction receipt status.kind",
        );
      return { result: "deterministicError", kind: raw.kind };
    case "reverted":
      if (
        raw.message !== undefined &&
        raw.message !== null &&
        typeof raw.message !== "string"
      )
        throw new InvalidTransactionReceiptError(
          "Invalid transaction receipt status.message",
        );
      return {
        result: "reverted",
        ...(raw.message === undefined ? {} : { message: raw.message }),
      };
    default:
      return { result: "other" };
  }
}

function parseOptionalBytes(
  value: string | null | undefined,
): Uint8Array | null {
  if (value === undefined || value === null) return null;
  return fromHex0x(value);
}

const MAX_GAS_USED = 0xffff_ffff_ffff_ffffn;

/**
 * Parse the receipt's `gasUsed`, a u64 on the wire. A JSON number is
 * only accepted while it is exactly representable, so a value the
 * transport already rounded is rejected rather than reported as
 * consensus data; larger values must arrive as a decimal string.
 */
function parseGasUsed(value: unknown): bigint {
  let parsed: bigint | undefined;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = BigInt(value);
  }
  if (parsed === undefined || parsed < 0n || parsed > MAX_GAS_USED) {
    throw new InvalidTransactionReceiptError(
      "Invalid transaction receipt response: expected gasUsed to be a u64",
    );
  }
  return parsed;
}

function parseHeight(value: unknown): bigint {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === ""
  ) {
    throw new InvalidTransactionReceiptError(
      "Invalid transaction receipt response: expected height",
    );
  }
  return BigInt(value);
}

/**
 * Return the receipt for a committed transaction.
 *
 * Returns `null` when the transaction is not found in committed history.
 */
export async function getTransactionReceipt(
  transport: Transport,
  txHash: SHA256Hash,
  options?: TransportRequestOptions,
): Promise<TransactionReceipt | null> {
  options?.signal?.throwIfAborted();
  const requestedHash = toHex0x(txHash);
  const result = await transport.request<unknown>(
    "groundhog_getTransactionReceipt",
    [requestedHash],
    options,
  );
  if (result === null) return null;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new InvalidTransactionReceiptError(
      "Invalid transaction receipt response",
    );
  }
  const receipt = result as RawTransactionReceipt;

  if (!Array.isArray(receipt.events)) {
    throw new InvalidTransactionReceiptError(
      "Invalid transaction receipt response: expected events",
    );
  }
  try {
    if (receipt.txHash !== requestedHash) {
      throw new InvalidTransactionReceiptError(
        "Transaction receipt hash does not match the requested transaction",
      );
    }
    return {
      txHash: hashFromHex(receipt.txHash),
      height: parseHeight(receipt.height),
      execResult: parseExecResult(receipt.status),
      executionStatus: parseExecutionStatus(receipt.status),
      events: receipt.events.map(parseEmittedEvent),
      returnData: parseOptionalBytes(receipt.returnData),
      abortData: parseOptionalBytes(receipt.abortData),
      gasUsed: parseGasUsed(receipt.gasUsed),
    };
  } catch (cause) {
    if (cause instanceof InvalidTransactionReceiptError) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new InvalidTransactionReceiptError(
      `Invalid transaction receipt response${detail}`,
      { cause },
    );
  }
}
