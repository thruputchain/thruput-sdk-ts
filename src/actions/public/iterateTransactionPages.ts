import type { RpcClient } from "../../rpc/client.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import type {
  AddressHistoryQuery,
  AddressTransactionPage,
  BlockTransactionQuery,
  TransactionRefPage,
} from "../../types/rpc.js";
import { walkHistory, type HistoryCompletion } from "./historyWalk.js";
export type AddressHistoryWalkQuery = Extract<
  AddressHistoryQuery,
  { start: unknown }
>;
export type BlockTransactionWalkQuery = Extract<
  BlockTransactionQuery,
  { start: unknown }
>;
/** Walk root-target and entered-address history within pinned retained coverage. */
export function iterateTransactionsByAddress(
  client: Pick<RpcClient, "getTransactionsByAddress">,
  query: AddressHistoryWalkQuery,
  options: TransportRequestOptions = {},
): AsyncGenerator<AddressTransactionPage, HistoryCompletion, unknown> {
  const snapshot = structuredClone(query);
  if (!snapshot.start || snapshot.cursor !== undefined)
    throw new TypeError("Address-history walks require an explicit start");
  return walkHistory(
    (cursor) =>
      client.getTransactionsByAddress(
        cursor === undefined
          ? snapshot
          : { address: snapshot.address, limit: snapshot.limit, cursor },
        options,
      ),
    "addressTransactions",
    { start: snapshot.start },
    options,
  ) as AsyncGenerator<AddressTransactionPage, HistoryCompletion, unknown>;
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
