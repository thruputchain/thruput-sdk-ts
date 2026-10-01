import type { SHA256Hash } from "@groundhogchain/protocol";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  ContractRejectCode,
  TransactionFailureCause,
  ConflictCode,
  ConflictDiagnostic,
  TransactionStatus,
} from "../../types/rpc.js";
import { addressFromHex, fromHex0x, toHex0x } from "../hex.js";

const conflictCodes = new Set<string>([
  "exclusiveLock",
  "typeMismatch",
  "valueMismatch",
  "boundsExceeded",
  "overflow",
  "replayProtection",
  "queueConsumer",
  "capacityExceeded",
  "insufficientFunds",
  "other",
]);

function parseConflictCode(code: unknown): ConflictCode {
  if (typeof code !== "string") {
    throw new Error(
      "Invalid transaction status response: expected conflict.code",
    );
  }
  return (conflictCodes.has(code) ? code : "other") as ConflictCode;
}

function parseConflictDiagnostic(value: unknown): ConflictDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid transaction status response: expected conflict");
  }
  const conflict = value as Record<string, unknown>;
  if (typeof conflict.address !== "string") {
    throw new Error(
      "Invalid transaction status response: expected conflict.address",
    );
  }
  if (typeof conflict.key !== "string") {
    throw new Error(
      "Invalid transaction status response: expected conflict.key",
    );
  }

  return {
    address: addressFromHex(conflict.address),
    key: fromHex0x(conflict.key),
    code: parseConflictCode(conflict.code),
  };
}

const contractRejectionCodes = new Set<string>([
  "tooMany",
  "blobTooLarge",
  "notDeployable",
  "duplicate",
  "malformedArtifact",
  "unsupportedFormat",
  "unsupportedAbi",
  "gasScheduleMismatch",
  "memoryTooLarge",
  "codeSizeInvalid",
  "initialMemoryInvalid",
  "digestMismatch",
  "invalidProgram",
  "other",
]);

function parseFailureCause(value: unknown): TransactionFailureCause {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid transaction status response: expected cause");
  }
  const cause = value as Record<string, unknown>;
  if (typeof cause.kind !== "string") {
    throw new Error("Invalid transaction status response: expected cause.kind");
  }
  switch (cause.kind) {
    case "dbConflict":
      return {
        kind: "dbConflict",
        conflict: parseConflictDiagnostic(cause.conflict),
      };
    case "contractRejected":
      if (
        typeof cause.contractIndex !== "number" ||
        !Number.isInteger(cause.contractIndex) ||
        cause.contractIndex < 0 ||
        cause.contractIndex > 0xffff_ffff
      ) {
        throw new Error(
          "Invalid transaction status response: expected cause.contractIndex as u32",
        );
      }
      if (typeof cause.code !== "string") {
        throw new Error(
          "Invalid transaction status response: expected cause.code",
        );
      }
      return {
        kind: "contractRejected",
        contractIndex: cause.contractIndex,
        code: (contractRejectionCodes.has(cause.code)
          ? cause.code
          : "other") as ContractRejectCode,
      };
    default:
      return { kind: "other" };
  }
}

/** Return the gateway's current knowledge of a submitted transaction. */
export async function getTransactionStatus(
  transport: Transport,
  txHash: SHA256Hash,
  options?: TransportRequestOptions,
): Promise<TransactionStatus> {
  options?.signal?.throwIfAborted();
  const raw = await transport.request<unknown>(
    "groundhog_getTransactionStatus",
    [toHex0x(txHash)],
    options,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid transaction status response");
  }

  const status = raw as Record<string, unknown>;
  if (typeof status.status !== "string") {
    throw new Error("Invalid transaction status response");
  }
  switch (status.status) {
    case "committed":
      if (
        typeof status.height !== "string" &&
        typeof status.height !== "number"
      ) {
        throw new Error(
          "Invalid transaction status response: expected block height",
        );
      }
      return { status: "committed", height: BigInt(status.height) };
    case "pending":
      return { status: "pending" };
    case "invalid": {
      if (typeof status.reason !== "string") {
        throw new Error("Invalid transaction status response: expected reason");
      }
      return { status: "invalid", reason: status.reason };
    }
    case "recentFailure":
      if (
        typeof status.attemptHeight !== "string" &&
        typeof status.attemptHeight !== "number"
      ) {
        throw new Error(
          "Invalid transaction status response: expected attempt height",
        );
      }
      return {
        status: "recentFailure",
        attemptHeight: BigInt(status.attemptHeight),
        cause: parseFailureCause(status.cause),
      };
    case "unknown":
      return { status: "unknown" };
    case "other":
      return { status: "other" };
    default:
      return { status: "other" };
  }
}
