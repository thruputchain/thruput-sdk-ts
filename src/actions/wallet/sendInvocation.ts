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
      throw new RpcCompatibilityError(
        "Signing network does not match endpoint discovery",
      );
  };
  checkNetwork();
  const signers = account.signers.map(({ signer, publicKeyId }) => ({
    signer,
    publicKeyId,
  }));
  const transaction = await prepareTransaction(client, account, request);
  checkNetwork();
  const signed = await sign(transaction, signers, signingNetwork);
  const evidence = createSubmissionEvidence(
    serialize(signed, codec.SignedTransaction),
    signingNetwork,
  );
  let phase: "beforeSubmission" | "submission" = "beforeSubmission";
  try {
    await controls.onSigned?.(evidence);
    controls.signal?.throwIfAborted();
    checkNetwork();
    phase = "submission";
    const result = await client.sendTransaction(
      { signedTransaction: evidence.signedTransaction },
      { signal: controls.signal },
    );
    assertTransactionAdmission(result);
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
