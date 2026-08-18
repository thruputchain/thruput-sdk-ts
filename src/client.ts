import type { Transport } from "./transport/types.js";
import type {
  ContractAddress,
  SHA256Hash,
  SignedTransaction,
} from "@groundhogchain/protocol";
import type {
  ChainTip,
  BalanceResponse,
  BlockInfo,
  VersionInfo,
  ViewRequest,
  ViewResponse,
  TransactionReceipt,
  TransactionStatus,
  AddressTransactionQuery,
  TransactionRefPage,
  EventQuery,
  EventPage,
  StorageItemRead,
} from "./types/rpc.js";
import { getChainTip } from "./actions/public/getChainTip.js";
import { getBalance } from "./actions/public/getBalance.js";
import { getBlockByNumber } from "./actions/public/getBlockByNumber.js";
import { getPendingTransactionCount } from "./actions/public/getPendingTransactionCount.js";
import { getTransactionReceipt } from "./actions/public/getTransactionReceipt.js";
import { getTransactionStatus } from "./actions/public/getTransactionStatus.js";
import {
  waitForTransactionReceipt,
  type WaitForTransactionReceiptOptions,
} from "./actions/public/waitForTransactionReceipt.js";
import { getTransactionsByAddress } from "./actions/public/getTransactionsByAddress.js";
import { getEvents } from "./actions/public/getEvents.js";
import { getStorageAt } from "./actions/public/getStorageAt.js";
import { getVersion } from "./actions/public/getVersion.js";
import { view } from "./actions/public/view.js";
import { sendTransaction } from "./actions/wallet/sendTransaction.js";

/**
 * Convenience client with all supported Groundhog actions bound to a single
 * transport.
 *
 * Use {@link createGroundhogClient} when application code should not pass a
 * transport into every action call.
 */
export interface GroundhogClient {
  /** Return the latest block height and hash reported by the gateway. */
  getChainTip(): Promise<ChainTip>;

  /** Return the HOG balance for a contract address. */
  getBalance(address: ContractAddress): Promise<BalanceResponse>;

  /** Return block metadata for a height, or `null` when the block is unknown. */
  getBlockByNumber(height: bigint): Promise<BlockInfo | null>;

  /** Return the number of transactions currently pending in the mempool. */
  getPendingTransactionCount(): Promise<bigint>;

  /** Return the gateway implementation and wire-format version. */
  getVersion(): Promise<VersionInfo>;

  /** Execute a read-only contract invocation without submitting a transaction. */
  view(request: ViewRequest): Promise<ViewResponse>;

  /** Return a committed transaction receipt, or `null` when it is not found. */
  getTransactionReceipt(txHash: SHA256Hash): Promise<TransactionReceipt | null>;

  /** Return the gateway's current knowledge of a submitted transaction. */
  getTransactionStatus(txHash: SHA256Hash): Promise<TransactionStatus>;

  /**
   * Wait for a transaction to commit and return its receipt.
   *
   * Inspect `receipt.execResult` to determine whether execution succeeded.
   */
  waitForTransactionReceipt(
    txHash: SHA256Hash,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<TransactionReceipt>;

  /** Query transaction refs whose root invocation targets one address. */
  getTransactionsByAddress(
    query: AddressTransactionQuery,
  ): Promise<TransactionRefPage>;

  /** Query emitted contract events with the gateway's paginated event API. */
  getEvents(query: EventQuery): Promise<EventPage>;

  /** Read a committed storage item at a contract address and storage key. */
  getStorageAt(
    address: ContractAddress,
    key: Uint8Array,
  ): Promise<StorageItemRead>;

  /** Submit a signed transaction and return its transaction hash. */
  sendTransaction(signedTx: SignedTransaction): Promise<SHA256Hash>;
}

/**
 * Create a convenience client by binding all SDK actions to a transport.
 *
 * The returned object is intentionally thin: each method delegates to the
 * corresponding standalone action with the provided transport.
 *
 * @example
 * ```ts
 * import { createGroundhogClient, HttpTransport } from "@groundhogchain/client";
 *
 * const client = createGroundhogClient(
 *   new HttpTransport("http://127.0.0.1:9545"),
 * );
 *
 * const tip = await client.getChainTip();
 * ```
 */
export function createGroundhogClient(transport: Transport): GroundhogClient {
  return {
    getChainTip: () => getChainTip(transport),
    getBalance: (address) => getBalance(transport, address),
    getBlockByNumber: (height) => getBlockByNumber(transport, height),
    getPendingTransactionCount: () => getPendingTransactionCount(transport),
    getVersion: () => getVersion(transport),
    view: (request) => view(transport, request),
    getTransactionReceipt: (txHash) => getTransactionReceipt(transport, txHash),
    getTransactionStatus: (txHash) => getTransactionStatus(transport, txHash),
    waitForTransactionReceipt: (txHash, options) =>
      waitForTransactionReceipt(transport, txHash, options),
    getTransactionsByAddress: (query) =>
      getTransactionsByAddress(transport, query),
    getEvents: (query) => getEvents(transport, query),
    getStorageAt: (address, key) => getStorageAt(transport, address, key),
    sendTransaction: (signedTx) => sendTransaction(transport, signedTx),
  };
}
