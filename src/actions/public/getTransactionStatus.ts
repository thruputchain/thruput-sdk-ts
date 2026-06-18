import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionStatus } from "../../types/rpc.js";
import { toHex0x } from "../hex.js";

export async function getTransactionStatus(
  transport: Transport,
  txHash: SHA256Hash,
): Promise<TransactionStatus> {
  const raw = await transport.request<unknown>(
    "groundhog_getTransactionStatus",
    [toHex0x(txHash)],
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid transaction status response");
  }

  const status = raw as Record<string, unknown>;
  if (typeof status.status !== "string") {
    throw new Error("Invalid transaction status response");
  }
  switch (status.status) {
    case "committed":
      if (
        typeof status.height !== "string" &&
        typeof status.height !== "number"
      ) {
        throw new Error(
          "Invalid transaction status response: expected block height",
        );
      }
      return { status: "committed", height: BigInt(status.height) };
    case "pending":
      return { status: "pending" };
    case "invalid": {
      if (typeof status.reason !== "string") {
        throw new Error("Invalid transaction status response: expected reason");
      }
      return { status: "invalid", reason: status.reason };
    }
    case "unknown":
      return { status: "unknown" };
    default:
      throw new Error("Invalid transaction status response: unknown status");
  }
}
