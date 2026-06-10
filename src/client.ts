import type { Transport } from "./transport/types.js";
import type {
  ContractAddress,
  SHA256Hash,
  SignedTransaction,
} from "@groundhogchain/protocol";
import type {
  ChainTip,
  VersionInfo,
  ViewRequest,
  ViewResponse,
  TransactionReceipt,
  TransactionStatus,
  EventQuery,
  EventPage,
  StorageItemRead,
} from "./types/rpc.js";
import { getChainTip } from "./actions/public/getChainTip.js";
import { getTransactionReceipt } from "./actions/public/getTransactionReceipt.js";
import { getTransactionStatus } from "./actions/public/getTransactionStatus.js";
import { getEvents } from "./actions/public/getEvents.js";
import { getStorageAt } from "./actions/public/getStorageAt.js";
import { getVersion } from "./actions/public/getVersion.js";
import { view } from "./actions/public/view.js";
import { sendTransaction } from "./actions/wallet/sendTransaction.js";

export interface GroundhogClient {
  getChainTip(): Promise<ChainTip>;
  getVersion(): Promise<VersionInfo>;
  view(request: ViewRequest): Promise<ViewResponse>;
  getTransactionReceipt(txHash: SHA256Hash): Promise<TransactionReceipt | null>;
  getTransactionStatus(txHash: SHA256Hash): Promise<TransactionStatus>;
  getEvents(query: EventQuery): Promise<EventPage>;
  getStorageAt(
    address: ContractAddress,
    key: Uint8Array,
  ): Promise<StorageItemRead>;
  sendTransaction(signedTx: SignedTransaction): Promise<SHA256Hash>;
}

export function createGroundhogClient(transport: Transport): GroundhogClient {
  return {
    getChainTip: () => getChainTip(transport),
    getVersion: () => getVersion(transport),
    view: (request) => view(transport, request),
    getTransactionReceipt: (txHash) => getTransactionReceipt(transport, txHash),
    getTransactionStatus: (txHash) => getTransactionStatus(transport, txHash),
    getEvents: (query) => getEvents(transport, query),
    getStorageAt: (address, key) => getStorageAt(transport, address, key),
    sendTransaction: (signedTx) => sendTransaction(transport, signedTx),
  };
}
