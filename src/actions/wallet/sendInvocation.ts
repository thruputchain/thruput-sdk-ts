import type {
  SHA256Hash,
  SignedTransaction,
  Transaction,
  NetworkHash,
} from "@groundhogchain/protocol";
import type { CoreGroundhogClient } from "../../client.js";
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
  client: Pick<CoreGroundhogClient, "getChainTip" | "sendTransaction">,
  account: WalletAccount,
  networkHash: NetworkHash,
  request: PrepareTransactionRequest,
): Promise<SHA256Hash> {
  const signers = account.signers.map(({ signer, publicKeyId }) => ({
    signer,
    publicKeyId,
  }));
  const transaction = await prepareTransaction(client, account, request);
  const signed = await sign(transaction, signers, networkHash);
  return client.sendTransaction(signed);
}
