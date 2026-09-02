import type { SHA256Hash } from "@groundhogchain/protocol";
import { ExecResult } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionReceipt } from "../../types/rpc.js";
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

function parseOptionalBytes(
  value: string | null | undefined,
): Uint8Array | null {
  if (value === undefined || value === null) return null;
  return fromHex0x(value);
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
): Promise<TransactionReceipt | null> {
  const result = await transport.request<unknown>(
    "groundhog_getTransactionReceipt",
    [toHex0x(txHash)],
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
    return {
      txHash: hashFromHex(receipt.txHash),
      height: parseHeight(receipt.height),
      execResult: parseExecResult(receipt.status),
      events: receipt.events.map(parseEmittedEvent),
      returnData: parseOptionalBytes(receipt.returnData),
      abortData: parseOptionalBytes(receipt.abortData),
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
