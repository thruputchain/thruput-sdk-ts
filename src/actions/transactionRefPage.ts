import type { TransactionRef, TransactionRefPage } from "../types/rpc.js";
import { fromHex0x } from "./hex.js";
import { hashFromBase58 } from "../encoding.js";
import { parseHeight } from "./decimal.js";

function parseTransactionRef(value: unknown): TransactionRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid transaction refs response: expected ref");
  }
  const ref = value as Record<string, unknown>;
  if (typeof ref.txHash !== "string") {
    throw new Error("Invalid transaction refs response: expected ref.txHash");
  }
  return {
    txHash: hashFromBase58(ref.txHash),
    height: parseHeight(ref.height),
  };
}

export function parseTransactionRefPage(raw: unknown): TransactionRefPage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid transaction refs response");
  }
  const result = raw as Record<string, unknown>;
  if (!Array.isArray(result.refs)) {
    throw new Error("Invalid transaction refs response: expected refs");
  }
  if (typeof result.cursor !== "string") {
    throw new Error("Invalid transaction refs response: expected cursor");
  }
  return {
    refs: result.refs.map(parseTransactionRef),
    cursor: fromHex0x(result.cursor),
    latestBlock: parseHeight(result.latestBlock, "latestBlock"),
    oldestBlock: parseHeight(result.oldestBlock, "oldestBlock"),
  };
}
