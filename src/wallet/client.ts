import type { ContractAddress } from "@groundhogchain/protocol";
import type { AirdropActions, CoreGroundhogClient } from "../client.js";
import type { AirdropSucceeded, BalanceResponse } from "../types/rpc.js";
import type { RequestAirdropOptions } from "../actions/public/requestAirdrop.js";
import type {
  PubkeyAccount,
  SourceAddressAccount,
  WalletAccount,
} from "./account.js";
import {
  defaultWalletAdapter,
  type WalletExecutionRequest,
  type WalletInvocationAdapter,
} from "./invocationAdapter.js";
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

const walletClientMarker = Symbol("GroundhogWalletClient");

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

/** Transaction options accepted when wrapping an inner wallet invocation. */
export type PrepareExecutionRequest<
  TRequest extends WalletExecutionRequest = WalletExecutionRequest,
> = TRequest & Omit<PrepareTransactionRequest, "invocation">;

/** Wallet-contract wrapping actions available when an adapter is configured. */
export interface WalletExecutionActions<
  TRequest extends WalletExecutionRequest = WalletExecutionRequest,
> {
  prepareExecution(
    request: PrepareExecutionRequest<TRequest>,
  ): Promise<Transaction>;
  execute(request: PrepareExecutionRequest<TRequest>): Promise<SHA256Hash>;
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
> = Omit<
  TClient,
  "getBalance" | "requestAirdrop" | "prepareExecution" | "execute"
> &
  WalletActions<TAccount> &
  (TClient extends AirdropActions ? WalletAirdropActions : object);

/** Wallet client with adapter-aware inner invocation execution. */
export type ExecutableWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount = WalletAccount,
  TRequest extends WalletExecutionRequest = WalletExecutionRequest,
> = WalletClient<TClient, TAccount> & WalletExecutionActions<TRequest>;

/** Decorate an existing client with signer-bound wallet behavior. */
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
  TRequest extends WalletExecutionRequest,
>(options: {
  readonly client: TClient;
  readonly account: TAccount;
  readonly invocationAdapter: WalletInvocationAdapter<TRequest>;
}): ExecutableWalletClient<TClient, TAccount, TRequest>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends PubkeyAccount,
>(options: {
  readonly client: TClient;
  readonly account: TAccount;
  readonly invocationAdapter?: undefined;
}): ExecutableWalletClient<TClient, TAccount>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends SourceAddressAccount,
>(options: {
  readonly client: TClient;
  readonly account: TAccount;
  readonly invocationAdapter?: undefined;
}): WalletClient<TClient, TAccount>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
>(options: {
  readonly client: TClient;
  readonly account: TAccount;
  readonly invocationAdapter?: undefined;
}): WalletClient<TClient, TAccount>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
>(options: {
  readonly client: TClient;
  readonly account: TAccount;
  readonly invocationAdapter?: WalletInvocationAdapter<never>;
}):
  | WalletClient<TClient, TAccount>
  | ExecutableWalletClient<TClient, TAccount, never> {
  const { client, account } = options;
  if (walletClientMarker in client) {
    throw new Error("A client can only be bound to one wallet account");
  }
  if ("execute" in client || "prepareExecution" in client) {
    throw new Error(
      "Client methods cannot use the reserved names execute or prepareExecution",
    );
  }
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

  const invocationAdapter =
    options.invocationAdapter ??
    (account.kind === "pubkey" ? defaultWalletAdapter : undefined);
  const execution = invocationAdapter
    ? {
        prepareExecution: (request: PrepareExecutionRequest) =>
          prepareTransaction(client, account, {
            ...request,
            invocation: invocationAdapter.createRootInvocation(
              account.address,
              request as never,
            ),
          }),
        execute: (request: PrepareExecutionRequest) =>
          sendInvocation(client, account, {
            ...request,
            invocation: invocationAdapter.createRootInvocation(
              account.address,
              request as never,
            ),
          }),
      }
    : {};

  const wallet = Object.assign(
    client,
    walletActions,
    airdrop,
    execution,
  ) as WalletClient<TClient, TAccount>;
  Object.defineProperty(wallet, walletClientMarker, { value: true });
  return wallet;
}
