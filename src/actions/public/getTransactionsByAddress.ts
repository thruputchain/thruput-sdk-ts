import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  AddressTransactionQuery,
  TransactionRef,
  TransactionRefPage,
} from "../../types/rpc.js";
import { fromHex0x, hashFromHex, toHex0x } from "../hex.js";
import { parseHeight, serializeHeight } from "../decimal.js";

interface RawTransactionRef {
  txHash: string;
  height: string;
}

interface RawTransactionRefPage {
  refs: unknown[];
  cursor: string;
  latestBlock: string;
  oldestBlock: string;
}

function serializeQuery(query: AddressTransactionQuery): unknown {
  const anchor =
    query.anchor === "beginning"
      ? { kind: "atBeginning" }
      : query.anchor === "end"
        ? { kind: "atEnd" }
        : query.anchor
          ? { kind: "atHeight", height: serializeHeight(query.anchor.height) }
          : { kind: "atBeginning" };

  return {
    address: toHex0x(query.address),
    order: query.order ?? "ascending",
    anchor,
    cursor: query.cursor ? toHex0x(query.cursor) : "0x",
    limit: query.limit ?? 50,
  };
}

function parseTransactionRef(value: unknown): TransactionRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid transaction refs response: expected ref");
  }
  const ref = value as Record<string, unknown>;

  if (typeof ref.txHash !== "string") {
    throw new Error("Invalid transaction refs response: expected ref.txHash");
  }
  return {
    txHash: hashFromHex(ref.txHash),
    height: parseHeight(ref.height),
  };
}

/**
 * Query transaction references whose root invocation targets one address.
 *
 * Use `cursor` from the returned page to request the next page with the same
 * address and ordering.
 * An empty cursor ends the walk, not an empty refs array. A cursor continues the
 * original historical walk, not new blocks. For ascending ingestion, start a new
 * ascending walk with an empty cursor at the last stored height and deduplicate
 * by transaction hash. Refresh descending history from anchor "end" with an empty
 * cursor. Commit rows and progress together; latestBlock is not a checkpoint.
 */
export async function getTransactionsByAddress(
  transport: Transport,
  query: AddressTransactionQuery,
  options?: TransportRequestOptions,
): Promise<TransactionRefPage> {
  options?.signal?.throwIfAborted();
  const raw = await transport.request<unknown>(
    "groundhog_getTransactionsByAddress",
    [serializeQuery(query)],
    options,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid transaction refs response");
  }
  const result = raw as RawTransactionRefPage;

  if (!Array.isArray(result.refs)) {
    throw new Error("Invalid transaction refs response: expected refs");
  }

  return {
    refs: result.refs.map(parseTransactionRef),
    cursor: fromHex0x(result.cursor),
    latestBlock: parseHeight(result.latestBlock, "latestBlock"),
    oldestBlock: parseHeight(result.oldestBlock, "oldestBlock"),
  };
}
