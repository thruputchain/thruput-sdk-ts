import { fromHex0x } from "../actions/hex.js";
import {
  isUnsupportedRpcValue,
  UnsupportedRpcValue,
} from "../rpc/unsupported.js";
import type { TransactionReceipt } from "../types/rpc.js";
import { createSubmissionEvidence } from "../transaction/submissionEvidence.js";
import {
  transactionErrorCodes,
  type ThruputErrorCode,
  type TransactionErrorCode,
} from "./codes.js";
import {
  defineEntry,
  maxJsonDepth,
  serializedMessageLimits,
  ThruputError,
  type ThruputErrorOptions,
  type ThruputErrorRequiredOptions,
} from "./thruputError.js";
import {
  receiptFacts,
  transactionOutcomes,
  transactionReasons,
  type TransactionFactsInput,
  type TransactionOutcome,
  type TransactionReason,
} from "./transaction.js";

const invalid = (message: string): never => {
  throw new TypeError(`Invalid serialized ThruputError: ${message}`);
};

/** A plain object, as `JSON.parse` returns. */
const record = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hex = (value: unknown, field: string): Uint8Array => {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(value))
    invalid(`${field} must be lowercase 0x hex`);
  return fromHex0x(value as string);
};

/**
 * Rebuild a {@link ThruputError} from the output of `toJSON()`, for example
 * after `postMessage`. Checks the shape and the transaction facts strictly; a
 * submission must hash to the transaction hash. Context values are decoded but
 * not checked against the code's type, so treat them as untrusted. Invalid input
 * throws a `TypeError`.
 */
export function parseThruputError(value: unknown): ThruputError {
  return parse(value, 0);
}

function parse(value: unknown, depth: number): ThruputError {
  if (!record(value)) return invalid("expected an object");
  const { name, code, shortMessage, details, context, transaction } = value;
  if (name !== "ThruputError") invalid("name must be ThruputError");
  if (typeof code !== "string" || !/^[a-z][A-Za-z0-9]{0,63}$/.test(code))
    invalid("code must be a camelCase string");
  const limits = serializedMessageLimits;
  if (
    typeof shortMessage !== "string" ||
    shortMessage.length > limits.shortMessage
  )
    invalid(
      `shortMessage must be a string of at most ${limits.shortMessage} characters`,
    );
  if (
    details !== undefined &&
    (typeof details !== "string" || details.length > limits.details)
  )
    invalid(`details must be a string of at most ${limits.details} characters`);
  if (!record(context)) invalid("context must be an object");
  if (
    transaction === undefined &&
    transactionErrorCodes.includes(code as TransactionErrorCode)
  )
    invalid(`${code as string} requires transaction`);
  const decodedContext = decodeJson(context, depth + 1);
  // A tag such as `{ "$bigint": "5" }` decodes to a value that is not a record.
  if (!record(decodedContext)) invalid("context must be an object");
  const options: ThruputErrorOptions<ThruputErrorCode> = {
    context: decodedContext as never,
    ...(details === undefined ? {} : { details: details as string }),
    ...(transaction === undefined
      ? {}
      : {
          transaction: parseTransaction(
            transaction,
            code as ThruputErrorCode,
            depth + 1,
          ),
        }),
  };
  // The checks above give each code the options it requires.
  return new ThruputError(
    code as ThruputErrorCode,
    shortMessage as string,
    options as typeof options & ThruputErrorRequiredOptions<ThruputErrorCode>,
  );
}

/** The outcome that each built-in transaction code always reports. */
const codeOutcomes: Partial<Record<ThruputErrorCode, TransactionOutcome>> = {
  transactionFailed: "failed",
  transactionOutcomeUnsupported: "unknown",
  transactionResultUndecodable: "succeeded",
  transactionResultUnavailable: "succeeded",
  transactionNotSubmitted: "notSubmitted",
  transactionOutcomeUnknown: "unknown",
  transactionAdmissionUnsupported: "unknown",
};

function parseTransaction(
  value: unknown,
  code: ThruputErrorCode,
  depth: number,
): TransactionFactsInput {
  if (!record(value)) return invalid("transaction must be an object");
  const hash = hex(value.hash, "transaction.hash");
  if (hash.length !== 32) invalid("transaction.hash must have 32 bytes");
  if (!transactionOutcomes.includes(value.outcome as TransactionOutcome))
    invalid("transaction.outcome is not supported");
  if (!transactionReasons.includes(value.reason as TransactionReason))
    invalid("transaction.reason is not supported");
  let submission;
  if (value.submission !== undefined) {
    if (!record(value.submission))
      invalid("transaction.submission must be an object");
    const fields = value.submission as Record<string, unknown>;
    const signedTransaction = hex(
      fields.signedTransaction,
      "transaction.submission.signedTransaction",
    );
    const networkHash = hex(
      fields.networkHash,
      "transaction.submission.networkHash",
    );
    try {
      submission = createSubmissionEvidence(signedTransaction, networkHash);
    } catch {
      return invalid("transaction.submission is not a signed transaction");
    }
    if (!equal(submission.transactionHash, hash))
      invalid("transaction.submission does not match transaction.hash");
  }
  const receipt =
    value.receipt === undefined
      ? undefined
      : (decodeJson(value.receipt, depth + 1) as TransactionReceipt);
  if (receipt !== undefined) {
    if (!isReceipt(receipt))
      invalid("transaction.receipt is not a transaction receipt");
    if (!equal(receipt.transactionHash, hash))
      invalid("transaction.receipt does not match transaction.hash");
    // A restored record must not contradict its proof of execution.
    const proven = receiptFacts(receipt, "resultUndecodable");
    if (proven.outcome !== value.outcome)
      invalid("transaction.outcome contradicts transaction.receipt");
    // A failed receipt fixes the reason. A successful one only rules out the
    // failure reasons: a stopped faucet attempt can report `timeout`.
    if (
      proven.outcome === "failed"
        ? proven.reason !== value.reason
        : proven.outcome === "succeeded" &&
          receiptReasons.includes(value.reason as TransactionReason)
    )
      invalid("transaction.reason contradicts transaction.receipt");
  } else if (value.outcome === "succeeded" || value.outcome === "failed") {
    invalid(`outcome ${value.outcome as string} requires transaction.receipt`);
  }
  const expected = codeOutcomes[code];
  if (expected !== undefined && expected !== value.outcome)
    invalid(`${code} requires outcome ${expected}`);
  return {
    hash,
    outcome: value.outcome as TransactionOutcome,
    reason: value.reason as TransactionReason,
    ...(receipt ? { receipt } : {}),
    ...(submission ? { submission } : {}),
  };
}

/** Reasons that only a failed or unsupported receipt can give. */
const receiptReasons: readonly TransactionReason[] = [
  "aborted",
  "faulted",
  "executionFailed",
  "outcomeUnsupported",
];

function decodeJson(value: unknown, depth: number): unknown {
  if (depth > maxJsonDepth) invalid("value is nested too deeply");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("numbers must be finite");
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry) => decodeJson(entry, depth + 1));
  // Only JSON data: not bigints, functions, bytes, or other live objects.
  if (!record(value)) return invalid("values must be JSON data");
  const keys = Object.keys(value);
  const tagged = value;
  if (keys.length === 1) {
    if (keys[0] === "$bytes") return hex(tagged.$bytes, "$bytes");
    if (keys[0] === "$bigint") {
      if (
        typeof tagged.$bigint !== "string" ||
        !/^-?(?:0|[1-9][0-9]*)$/.test(tagged.$bigint)
      )
        invalid("$bigint must be a decimal string");
      return BigInt(tagged.$bigint as string);
    }
    if (keys[0] === "$unsupported")
      return new UnsupportedRpcValue(
        decodeJson(tagged.$unsupported, depth + 1),
      );
    if (keys[0] === "$literal") {
      // A plain object that looked like a tag; decode its entries only.
      const literal = tagged.$literal;
      if (!record(literal)) invalid("$literal must be an object");
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(literal as object))
        defineEntry(result, key, decodeJson(entry, depth + 1));
      return result;
    }
    if (keys[0] === "$error") {
      const error = tagged.$error;
      if (record(error) && error.name === "ThruputError")
        return parse(error, depth + 1);
      if (!record(error) || typeof error.name !== "string")
        invalid("$error must have a name");
      return Object.assign(new Error(), {
        name: (error as { name: string }).name,
      });
    }
  }
  const result: Record<string, unknown> = {};
  for (const key of keys)
    defineEntry(result, key, decodeJson(tagged[key], depth + 1));
  return result;
}

const failedResults: readonly unknown[] = [
  "fault",
  "nonDeterministicError",
  "failedGasSponsorship",
  "other",
];

/** Check the receipt fields that error handling reads. */
function isReceipt(value: unknown): value is TransactionReceipt {
  if (
    !record(value) ||
    !(value.transactionHash instanceof Uint8Array) ||
    typeof value.blockHeight !== "bigint" ||
    typeof value.gasUsed !== "bigint" ||
    !Array.isArray(value.events)
  )
    return false;
  const { execution } = value;
  if (isUnsupportedRpcValue(execution)) return true;
  if (!record(execution)) return false;
  if (execution.result === "return")
    return execution.returnData instanceof Uint8Array;
  if (execution.result === "abort")
    return execution.abortData instanceof Uint8Array;
  return failedResults.includes(execution.result);
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length && left.every((byte, i) => byte === right[i])
  );
}
