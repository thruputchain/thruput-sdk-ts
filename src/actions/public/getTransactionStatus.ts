import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionStatus } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";

export async function getTransactionStatus(
  transport: Transport,
  txHash: SHA256Hash,
): Promise<TransactionStatus> {
  const raw = await transport.request<{
    status: string;
    height?: number;
    reason?: string;
  }>("groundhog_getTransactionStatus", [toHex0x(txHash)]);
  switch (raw.status) {
    case "committed":
      return { status: "committed", height: BigInt(raw.height!) };
    case "pending":
      return { status: "pending" };
    case "invalid":
      return { status: "invalid", reason: raw.reason ?? "" };
    default:
      return { status: "unknown" };
  }
}
