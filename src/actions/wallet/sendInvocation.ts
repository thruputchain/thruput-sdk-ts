import type {
  SHA256Hash,
  SignedTransaction,
  Transaction,
  NetworkHash,
} from "@thruputchain/protocol";
import { codec, serialize, sha256Hash } from "@thruputchain/protocol";
import {
  createSubmissionEvidence,
  TransactionObservationError,
  type SubmissionEvidence,
} from "../../wallet/execution.js";
import { RpcRequestValidationError } from "../../rpc/codec.js";
import { RpcCompatibilityError } from "../../rpc/client.js";
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
    "getChainTip" | "sendTransaction" | "requireMethods"
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
  const signers = account.signers.map(({ signer, publicKeyId }) => ({
    signer,
    publicKeyId,
  }));
  const transaction = await prepareTransaction(client, account, request);
  const signed = await sign(transaction, signers, networkHash);
  const evidence = createSubmissionEvidence(
    serialize(signed, codec.SignedTransaction),
    networkHash,
  );
  let phase: "beforeSubmission" | "submission" = "beforeSubmission";
  try {
    await controls.onSigned?.(evidence);
    controls.signal?.throwIfAborted();
    phase = "submission";
    const result = await client.sendTransaction(
      { signedTransaction: evidence.signedTransaction },
      { signal: controls.signal },
    );
    return sha256Hash(result.transactionHash);
  } catch (cause) {
    throw new TransactionObservationError(
      evidence,
      cause,
      undefined,
      undefined,
      cause instanceof RpcRequestValidationError ||
        cause instanceof RpcCompatibilityError
        ? "beforeSubmission"
        : phase,
    );
  }
}
