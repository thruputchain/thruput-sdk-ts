import type {
  SHA256Hash,
  SignedTransaction,
  Transaction,
  NetworkHash,
} from "@thruputchain/protocol";
import { codec, serialize, sha256Hash } from "@thruputchain/protocol";
import {
  createSubmissionEvidence,
  assertTransactionAdmission,
  type SubmissionEvidence,
} from "../../wallet/execution.js";
import { rpcIncompatible } from "../../rpc/client.js";
import {
  isLocalRequestError,
  reasonAfterDispatch,
  reasonBeforeDispatch,
  transactionNotSubmitted,
  transactionOutcomeUnknown,
} from "../../wallet/transactionErrors.js";
import type { CoreThruputClient } from "../../client.js";
import type { WalletAccount } from "../../wallet/account.js";
import { signTransaction as sign } from "../../transaction/sign.js";
import {
  prepareTransaction,
  type PrepareTransactionRequest,
} from "./prepareTransaction.js";

/** Sign a transaction with a wallet account's configured signers. */
export function signWalletTransaction(
  account: WalletAccount,
  transaction: Transaction,
  networkHash: NetworkHash,
): Promise<SignedTransaction> {
  return sign(transaction, account.signers, networkHash);
}

/** Prepare, sign, and submit one explicit root invocation. */
export async function sendInvocation(
  client: Pick<
    CoreThruputClient,
    "getChainTip" | "sendTransaction" | "requireMethods" | "discovery"
  >,
  account: WalletAccount,
  networkHash: NetworkHash,
  request: PrepareTransactionRequest,
  controls: {
    signal?: AbortSignal;
    onSigned?: (evidence: SubmissionEvidence) => void | Promise<void>;
  } = {},
): Promise<SHA256Hash> {
  controls.signal?.throwIfAborted();
  client.requireMethods(["getChainTip", "sendTransaction"]);
  const signingNetwork = new Uint8Array(networkHash) as NetworkHash;
  const checkNetwork = () => {
    const discovered = client.discovery.network.networkHash;
    if (
      signingNetwork.length !== 32 ||
      discovered.length !== 32 ||
      signingNetwork.some((value, index) => value !== discovered[index])
    )
      throw rpcIncompatible(
        "network",
        "Signing network does not match endpoint discovery",
      );
  };
  checkNetwork();
  const signers = account.signers.map(({ signer, publicKeyId }) => ({
    signer,
    publicKeyId,
  }));
  const transaction = await prepareTransaction(client, account, request);
  // Do not sign a transaction the caller has cancelled.
  controls.signal?.throwIfAborted();
  checkNetwork();
  const signed = await sign(transaction, signers, signingNetwork);
  const evidence = createSubmissionEvidence(
    serialize(signed, codec.SignedTransaction),
    signingNetwork,
  );
  // Do not persist a transaction the caller cancelled while it was signed.
  if (controls.signal?.aborted)
    throw transactionNotSubmitted(
      evidence,
      "cancelled",
      controls.signal.reason,
    );
  try {
    await controls.onSigned?.(evidence);
  } catch (cause) {
    throw transactionNotSubmitted(evidence, "persistenceFailed", cause);
  }
  try {
    controls.signal?.throwIfAborted();
    checkNetwork();
  } catch (cause) {
    throw transactionNotSubmitted(
      evidence,
      reasonBeforeDispatch(cause, controls.signal),
      cause,
    );
  }
  let result;
  try {
    result = await client.sendTransaction(
      { signedTransaction: evidence.signedTransaction },
      { signal: controls.signal },
    );
  } catch (cause) {
    if (isLocalRequestError(cause, controls.signal))
      throw transactionNotSubmitted(evidence, "requestInvalid", cause);
    throw transactionOutcomeUnknown(
      evidence,
      reasonAfterDispatch(cause, controls.signal),
      cause,
    );
  }
  assertTransactionAdmission(result, evidence);
  return sha256Hash(result.transactionHash);
}
