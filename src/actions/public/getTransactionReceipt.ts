import type { SHA256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import type { TransactionReceipt } from "../../types/rpc.js";
import { toHex0x, hashFromHex, fromHex0x, addressFromHex } from "../hex.js";

export async function getTransactionReceipt(
  transport: Transport,
  txHash: SHA256Hash,
): Promise<TransactionReceipt | null> {
  const result = await transport.request<any>(
    "groundhog_getTransactionReceipt",
    [toHex0x(txHash)],
  );
  if (result === null) return null;
  return {
    txHash: hashFromHex(result.txHash),
    height: BigInt(result.height),
    status: result.status,
    events: (result.events ?? []).map((e: any) => ({
      contractAddress: addressFromHex(e.contractAddress),
      topics: (e.topics ?? []).map((t: string) => fromHex0x(t)),
      data: e.data ? fromHex0x(e.data) : new Uint8Array(0),
    })),
    returnData: result.returnData ? fromHex0x(result.returnData) : null,
  };
}
