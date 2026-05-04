import type { Transport } from "./transport/types.js";
import type { SHA256Hash, SignedTransaction } from "@groundhogchain/protocol";
import type {
  ChainTip,
  TransactionReceipt,
  TransactionStatus,
  DevAccount,
} from "./types/rpc.js";
import { getChainTip } from "./actions/public/getChainTip.js";
import { getTransactionReceipt } from "./actions/public/getTransactionReceipt.js";
import { getTransactionStatus } from "./actions/public/getTransactionStatus.js";
import { sendTransaction } from "./actions/wallet/sendTransaction.js";
import { devReset, devGetAccounts } from "./actions/dev/index.js";

export interface GroundhogClient {
  getChainTip(): Promise<ChainTip>;
  getTransactionReceipt(txHash: SHA256Hash): Promise<TransactionReceipt | null>;
  getTransactionStatus(txHash: SHA256Hash): Promise<TransactionStatus>;
  sendTransaction(signedTx: SignedTransaction): Promise<SHA256Hash>;
  dev: {
    reset(): Promise<void>;
    getAccounts(): Promise<DevAccount[]>;
  };
}

export function createGroundhogClient(transport: Transport): GroundhogClient {
  return {
    getChainTip: () => getChainTip(transport),
    getTransactionReceipt: (txHash) => getTransactionReceipt(transport, txHash),
    getTransactionStatus: (txHash) => getTransactionStatus(transport, txHash),
    sendTransaction: (signedTx) => sendTransaction(transport, signedTx),
    dev: {
      reset: () => devReset(transport),
      getAccounts: () => devGetAccounts(transport),
    },
  };
}
