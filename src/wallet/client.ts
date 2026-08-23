import type { ContractAddress } from "@groundhogchain/protocol";
import type { AirdropActions, CoreGroundhogClient } from "../client.js";
import type { AirdropSucceeded, BalanceResponse } from "../types/rpc.js";
import type { RequestAirdropOptions } from "../actions/public/requestAirdrop.js";
import type { WalletAccount } from "./account.js";
import {
  prepareTransaction,
  type PrepareTransactionRequest,
} from "../actions/wallet/prepareTransaction.js";
import {
  sendInvocation,
  signWalletTransaction,
} from "../actions/wallet/sendInvocation.js";
import type {
  SHA256Hash,
  SignedTransaction,
  Transaction,
} from "@groundhogchain/protocol";

/** Wallet airdrop options with the bound account as the default recipient. */
export type WalletRequestAirdropOptions = Omit<
  RequestAirdropOptions,
  "recipient"
> & {
  readonly recipient?: ContractAddress;
};

/** Signer-bound transaction and account actions. */
export interface WalletActions<TAccount extends WalletAccount = WalletAccount> {
  readonly account: TAccount;
  getBalance(address?: ContractAddress): Promise<BalanceResponse>;
  prepareTransaction(request: PrepareTransactionRequest): Promise<Transaction>;
  signTransaction(transaction: Transaction): Promise<SignedTransaction>;
  sendInvocation(request: PrepareTransactionRequest): Promise<SHA256Hash>;
}

/** Account-defaulted funding available when the underlying client supports it. */
export interface WalletAirdropActions {
  requestAirdrop(
    options?: WalletRequestAirdropOptions,
  ): Promise<AirdropSucceeded>;
}

/** Existing client methods plus signer-bound wallet actions. */
export type WalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount = WalletAccount,
> = Omit<TClient, "getBalance" | "requestAirdrop"> &
  WalletActions<TAccount> &
  (TClient extends AirdropActions ? WalletAirdropActions : object);

/** Decorate an existing client with signer-bound wallet behavior. */
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
>(options: {
  readonly client: TClient;
  readonly account: TAccount;
}): WalletClient<TClient, TAccount> {
  const { client, account } = options;
  const getBalance = client.getBalance.bind(client);
  const requestAirdrop =
    "requestAirdrop" in client
      ? (
          client as CoreGroundhogClient & Pick<AirdropActions, "requestAirdrop">
        ).requestAirdrop.bind(client)
      : undefined;
  const walletActions: WalletActions<TAccount> = {
    account,
    getBalance: (address = account.address) => getBalance(address),
    prepareTransaction: (request) =>
      prepareTransaction(client, account, request),
    signTransaction: (transaction) =>
      signWalletTransaction(account, transaction),
    sendInvocation: (request) => sendInvocation(client, account, request),
  };

  const airdrop = requestAirdrop
    ? {
        requestAirdrop: (request: WalletRequestAirdropOptions = {}) =>
          requestAirdrop({
            ...request,
            recipient: request.recipient ?? account.address,
          }),
      }
    : {};

  return Object.assign(client, walletActions, airdrop) as WalletClient<
    TClient,
    TAccount
  >;
}
