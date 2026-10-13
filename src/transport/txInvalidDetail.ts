import { ThruputRpcErrorCode, JsonRpcError } from "./http.js";

/**
 * Why `sendRawTransaction` rejected a transaction before submitting it: the
 * network-config bound it violates. Carried as the `data` of a `TxInvalid`
 * JSON-RPC error when the rejection comes from a pre-submission bound check.
 *
 * `index` and `firstIndex` are positions in the transaction's
 * `contractsToDeploy`.
 */
export type TxInvalidDetail =
  | {
      readonly reason: "tooManyContracts";
      readonly attached: number;
      readonly max: number;
    }
  | {
      readonly reason: "contractTooLarge";
      readonly index: number;
      readonly sizeBytes: number;
      readonly maxBytes: number;
    }
  | {
      readonly reason: "duplicateContract";
      readonly index: number;
      readonly firstIndex: number;
    }
  | {
      readonly reason: "rv32MemoryTooLarge";
      readonly index: number;
      readonly memoryBytes: number;
      readonly maxBytes: number;
    }
  | {
      readonly reason: "rv32CodeTooLarge";
      readonly index: number;
      readonly codeBytes: number;
      readonly maxBytes: number;
    };

const FIELDS: Record<TxInvalidDetail["reason"], readonly string[]> = {
  tooManyContracts: ["attached", "max"],
  contractTooLarge: ["index", "sizeBytes", "maxBytes"],
  duplicateContract: ["index", "firstIndex"],
  rv32MemoryTooLarge: ["index", "memoryBytes", "maxBytes"],
  rv32CodeTooLarge: ["index", "codeBytes", "maxBytes"],
};

/**
 * Read the violated bound from a `TxInvalid` error.
 *
 * Returns `null` for any other error, for a `TxInvalid` rejection that is not
 * a bound check (malformed XDR, for example), and for a `reason` this client
 * does not know, which a newer server may add.
 */
export function txInvalidDetail(error: unknown): TxInvalidDetail | null {
  if (
    !(error instanceof JsonRpcError) ||
    error.code !== ThruputRpcErrorCode.TxInvalid
  ) {
    return null;
  }
  const data = error.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const detail = data as Record<string, unknown>;
  const reason = detail.reason;
  if (typeof reason !== "string" || !Object.hasOwn(FIELDS, reason)) return null;
  const fields = FIELDS[reason as TxInvalidDetail["reason"]];
  const parsed: Record<string, unknown> = { reason };
  for (const field of fields) {
    const value = detail[field];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 0xffff_ffff
    ) {
      return null;
    }
    parsed[field] = value;
  }
  return parsed as TxInvalidDetail;
}
