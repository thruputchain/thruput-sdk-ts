import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  BlockTransactionQuery,
  TransactionRefPage,
} from "../../types/rpc.js";
import { serializeHeight } from "../decimal.js";
import { toHex0x } from "../hex.js";
import { parseTransactionRefPage } from "../transactionRefPage.js";

/**
 * Read transaction references at one committed height in unsigned hash order.
 *
 * Omitted limit sends 50; zero is invalid. Preserve the cursor and height between
 * pages. A continuation retains its original order. An empty cursor ends a walk.
 * Invalid/stale cursors currently return empty terminal pages. A continuation
 * above a lagging index's tip fails as unavailable. Backend errors propagate.
 *
 * Coverage starts at height 1; genesis metadata is unavailable. An empty page
 * does not prove a block exists: use {@link getBlockByNumber} to distinguish an
 * empty block from a height outside coverage. Bounds can lag behind chainTip.
 */
export async function getTransactionsByBlock(
  transport: Transport,
  query: BlockTransactionQuery,
  options?: TransportRequestOptions,
): Promise<TransactionRefPage> {
  options?.signal?.throwIfAborted();
  const requestedHeight = query.height;
  const height = serializeHeight(requestedHeight);
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError("limit must be an integer from 1 to 200");
  }
  const order = query.order ?? "ascending";
  if (order !== "ascending" && order !== "descending") {
    throw new Error("order must be ascending or descending");
  }
  const cursor = query.cursor ? toHex0x(query.cursor) : "0x";
  const raw = await transport.request<unknown>(
    "groundhog_getTransactionsByBlock",
    [{ height, order, cursor, limit }],
    options,
  );
  const page = parseTransactionRefPage(raw);
  if (
    page.oldestBlock < 1n ||
    page.latestBlock < page.oldestBlock ||
    page.refs.length > limit ||
    page.refs.some((ref) => ref.height !== requestedHeight) ||
    ((requestedHeight < page.oldestBlock ||
      requestedHeight > page.latestBlock) &&
      (page.refs.length !== 0 || page.cursor.length !== 0)) ||
    (page.cursor.length !== 0 &&
      (page.refs.length === 0 || toHex0x(page.cursor) === cursor))
  ) {
    throw new Error(
      "Invalid block transaction page: inconsistent height, coverage, or continuation",
    );
  }
  const hashes = page.refs.map((ref) => toHex0x(ref.txHash));
  const ascending = hashes.every((hash, i) => i === 0 || hashes[i - 1]! < hash);
  const descending = hashes.every(
    (hash, i) => i === 0 || hashes[i - 1]! > hash,
  );
  if (
    !(cursor === "0x"
      ? order === "ascending"
        ? ascending
        : descending
      : ascending || descending)
  ) {
    throw new Error(
      "Invalid block transaction page: hashes must be strictly ordered",
    );
  }
  return page;
}
