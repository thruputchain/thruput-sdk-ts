import type { RpcClient } from "../../rpc/client.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import type {
  RootAddressTransactionQuery,
  BlockTransactionQuery,
  TransactionRefPage,
} from "../../types/rpc.js";
import { walkHistory, type HistoryCompletion } from "./historyWalk.js";
export type RootAddressWalkQuery = Extract<
  RootAddressTransactionQuery,
  { start: unknown }
>;
export type BlockTransactionWalkQuery = Extract<
  BlockTransactionQuery,
  { start: unknown }
>;
/** Transactions sent by this root address; incoming transfers use token events. */
export function iterateTransactionsByRootAddress(
  client: Pick<RpcClient, "getTransactionsByRootAddress">,
  query: RootAddressWalkQuery,
  options: TransportRequestOptions = {},
): AsyncGenerator<TransactionRefPage, HistoryCompletion, unknown> {
  const snapshot = structuredClone(query);
  if (!snapshot.start || snapshot.cursor !== undefined)
    throw new TypeError("Root-address walks require an explicit start");
  return walkHistory(
    (cursor) =>
      client.getTransactionsByRootAddress(
        cursor === undefined
          ? snapshot
          : { address: snapshot.address, limit: snapshot.limit, cursor },
        options,
      ),
    "transactions",
    { start: snapshot.start },
    options,
  ) as AsyncGenerator<TransactionRefPage, HistoryCompletion, unknown>;
}
/** Walk one covered block. Completion never establishes a whole-chain checkpoint. */
export function iterateTransactionsByBlock(
  client: Pick<RpcClient, "getTransactionsByBlock">,
  query: BlockTransactionWalkQuery,
  options: TransportRequestOptions = {},
): AsyncGenerator<TransactionRefPage, void, unknown> {
  const snapshot = structuredClone(query);
  if (!snapshot.start || snapshot.cursor !== undefined)
    throw new TypeError("Block walks require an explicit start");
  return walkHistory(
    (cursor) =>
      client.getTransactionsByBlock(
        cursor === undefined
          ? snapshot
          : {
              blockHeight: snapshot.blockHeight,
              limit: snapshot.limit,
              cursor,
            },
        options,
      ),
    "transactions",
    { blockHeight: snapshot.blockHeight, order: snapshot.start.order },
    options,
  ) as AsyncGenerator<TransactionRefPage, void, unknown>;
}
