import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  AddressTransactionQuery,
  TransactionRefPage,
} from "../../types/rpc.js";
import { toHex0x } from "../hex.js";
import { serializeHeight } from "../decimal.js";
import { parseTransactionRefPage } from "../transactionRefPage.js";

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
  return parseTransactionRefPage(raw);
}
