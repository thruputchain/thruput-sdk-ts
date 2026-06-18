import type { SHA256Hash } from "@groundhogchain/protocol";
import { ExecResult } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { EmittedEvent, TransactionReceipt } from "../../types/rpc.js";
import { toHex0x, hashFromHex, addressFromHex, fromHex0x } from "../hex.js";

interface RawExecStatus {
  result: string;
}

interface RawEmittedEvent {
  contractAddress: string;
  topics: string[];
  data: string;
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

function parseExecResult(status: unknown): ExecResult {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Invalid transaction receipt response: expected status");
  }
  const raw = status as RawExecStatus;
  const mapped = execStatusToResult[raw.result];
  if (mapped !== undefined) return mapped;
  return ExecResult.ExecResultUnrecoverable;
}

function parseEvent(value: unknown): EmittedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid transaction receipt response: expected event");
  }
  const event = value as RawEmittedEvent;

  if (!Array.isArray(event.topics)) {
    throw new Error(
      "Invalid transaction receipt response: expected event.topics",
    );
  }

  return {
    contractAddress: addressFromHex(event.contractAddress),
    topics: event.topics.map(fromHex0x),
    data: fromHex0x(event.data),
  };
}

function parseOptionalBytes(
  value: string | null | undefined,
): Uint8Array | null {
  if (value === undefined || value === null) return null;
  return fromHex0x(value);
}

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
    throw new Error("Invalid transaction receipt response");
  }
  const receipt = result as RawTransactionReceipt;

  if (!Array.isArray(receipt.events)) {
    throw new Error("Invalid transaction receipt response: expected events");
  }

  return {
    txHash: hashFromHex(receipt.txHash),
    height: BigInt(receipt.height),
    execResult: parseExecResult(receipt.status),
    events: receipt.events.map(parseEvent),
    returnData: parseOptionalBytes(receipt.returnData),
    abortData: parseOptionalBytes(receipt.abortData),
  };
}
