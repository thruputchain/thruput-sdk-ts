import {
  serialize,
  codec,
  sha256Hash,
  type SignedTransaction,
  type SHA256Hash,
} from "@thruputchain/protocol";
import type { RpcClient } from "../../rpc/client.js";
import type { TransportRequestOptions } from "../../transport/types.js";

/** Serialize and submit once through the native RPC boundary. */
export async function sendTransaction(
  client: Pick<RpcClient, "sendTransaction">,
  signedTx: SignedTransaction,
  options?: TransportRequestOptions,
): Promise<SHA256Hash> {
  const result = await client.sendTransaction(
    { signedTransaction: serialize(signedTx, codec.SignedTransaction) },
    options,
  );
  return sha256Hash(result.transactionHash);
}
