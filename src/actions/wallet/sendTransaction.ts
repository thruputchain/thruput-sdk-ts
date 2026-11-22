import {
  serialize,
  codec,
  sha256Hash,
  type SignedTransaction,
  type SHA256Hash,
} from "@thruputchain/protocol";
import type { RpcClient } from "../../rpc/client.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import {
  assertTransactionAdmission,
  createSubmissionEvidence,
} from "../../wallet/execution.js";

/**
 * Serialize and submit once through the native RPC boundary.
 * Unknown admission throws code `transactionAdmissionUnsupported` with the signed
 * bytes and destination discovery network; that network does not prove the
 * signing network of an already-signed envelope. RPC and transport failures
 * propagate unchanged.
 */
export async function sendTransaction(
  client: Pick<RpcClient, "sendTransaction" | "discovery">,
  signedTx: SignedTransaction,
  options?: TransportRequestOptions,
): Promise<SHA256Hash> {
  const evidence = createSubmissionEvidence(
    serialize(signedTx, codec.SignedTransaction),
    client.discovery.network.networkHash,
  );
  const result = await client.sendTransaction(
    { signedTransaction: evidence.signedTransaction },
    options,
  );
  assertTransactionAdmission(result, evidence);
  return sha256Hash(result.transactionHash);
}
