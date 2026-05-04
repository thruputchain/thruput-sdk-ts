import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionStatus } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";

export async function getTransactionStatus(
  transport: Transport,
  txHash: SHA256Hash,
): Promise<TransactionStatus> {
  return transport.request<TransactionStatus>(
    "groundhog_getTransactionStatus",
    [toHex0x(txHash)],
  );
}
