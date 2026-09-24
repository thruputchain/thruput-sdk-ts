import {
  networkHash as toNetworkHash,
  sha256Hash,
  type ContractAddress,
  type NetworkHash,
  type GasAmount,
} from "@groundhogchain/protocol";
import type { AirdropActions, CoreGroundhogClient } from "../client.js";
import type { TransportRequestOptions } from "../transport/types.js";
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
import {
  submitAndObserve,
  assertTransactionSuccess,
  decodeExecution,
  type CallResults,
  type ExecutionResult,
} from "./execution.js";
import type { ContractCall } from "../contract/method.js";
import type { ExecuteCallsRequest } from "./providerClient.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import type { WaitForTransactionReceiptOptions } from "../actions/public/waitForTransactionReceipt.js";
import {
  deploymentRequest,
  decodeDeployment,
  type ContractDeployment,
} from "./deployment.js";

const walletClientMarker = Symbol("GroundhogWalletClient");
const reservedWalletClientProperties = [
  "account",
  "prepareTransaction",
  "signTransaction",
  "sendInvocation",
  "prepareExecution",
  "execute",
  "executeAndWait",
  "executeCallsAndWait",
  "prepareDeployment",
  "deployContract",
  "deployContractAndWait",
] as const;

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
  getBalance(
    address?: ContractAddress,
    options?: TransportRequestOptions,
  ): Promise<BalanceResponse>;
  prepareTransaction(request: PrepareTransactionRequest): Promise<Transaction>;
  signTransaction(transaction: Transaction): Promise<SignedTransaction>;
  sendInvocation(request: PrepareTransactionRequest): Promise<SHA256Hash>;
  /** Prepare a root deployment after any required address prefunding. */
  prepareDeployment(
    deployment: ContractDeployment,
    gasLimit: GasAmount,
  ): Promise<Transaction>;
  /** Submit deployment and return its predicted address before commitment. */
  deployContract(
    deployment: ContractDeployment,
    gasLimit: GasAmount,
  ): Promise<{ txHash: SHA256Hash; address: ContractAddress }>;
  /** Deploy, wait for success and verify the returned address. */
  deployContractAndWait(
    deployment: ContractDeployment,
    gasLimit: GasAmount,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<ExecutionResult & { address: ContractAddress }>;
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
  /** Submit and require a successful committed receipt. */
  executeAndWait(
    request: PrepareExecutionRequest<TRequest>,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<ExecutionResult>;
  /** Execute typed calls atomically and decode their ordered return values. */
  executeCallsAndWait<T extends readonly ContractCall[]>(
    request: ExecuteCallsRequest<T>,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<ExecutionResult & { values: CallResults<T> }>;
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
  | "getBalance"
  | "requestAirdrop"
  | "account"
  | "prepareTransaction"
  | "signTransaction"
  | "sendInvocation"
  | "prepareExecution"
  | "execute"
> &
  WalletActions<TAccount> &
  (TClient extends AirdropActions ? WalletAirdropActions : object);

/** Wallet client with adapter-aware inner invocation execution. */
export type ExecutableWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount = WalletAccount,
  TRequest extends WalletExecutionRequest = WalletExecutionRequest,
> = WalletClient<TClient, TAccount> & WalletExecutionActions<TRequest>;

/** Signing-network input inferred from whether a client has validated identity. */
export type WalletNetworkOptions<TClient extends CoreGroundhogClient> =
  TClient extends { readonly network: { readonly networkHash: NetworkHash } }
    ? { readonly networkHash?: never }
    : {
        /** Signing network required when the client has no validated identity. */
        readonly networkHash: NetworkHash;
      };

/** Decorate an existing client with signer-bound wallet behavior. */
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
  TRequest extends WalletExecutionRequest,
>(
  options: {
    readonly client: TClient;
    readonly account: TAccount;
    readonly invocationAdapter: WalletInvocationAdapter<TRequest>;
  } & WalletNetworkOptions<TClient>,
): ExecutableWalletClient<TClient, TAccount, TRequest>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends PubkeyAccount,
>(
  options: {
    readonly client: TClient;
    readonly account: TAccount;
    readonly invocationAdapter?: undefined;
  } & WalletNetworkOptions<TClient>,
): ExecutableWalletClient<TClient, TAccount>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends SourceAddressAccount,
>(
  options: {
    readonly client: TClient;
    readonly account: TAccount;
    readonly invocationAdapter?: undefined;
  } & WalletNetworkOptions<TClient>,
): WalletClient<TClient, TAccount>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
>(
  options: {
    readonly client: TClient;
    readonly account: TAccount;
    readonly invocationAdapter?: undefined;
  } & WalletNetworkOptions<TClient>,
): WalletClient<TClient, TAccount>;
export function createWalletClient<
  TClient extends CoreGroundhogClient,
  TAccount extends WalletAccount,
>(
  options: {
    readonly client: TClient;
    readonly account: TAccount;
    readonly invocationAdapter?: WalletInvocationAdapter<never>;
  } & { readonly networkHash?: NetworkHash },
):
  | WalletClient<TClient, TAccount>
  | ExecutableWalletClient<TClient, TAccount, never> {
  const { client, account } = options;
  const sourceNetworkHash =
    getConnectedNetworkHash(client) ?? options.networkHash;
  if (sourceNetworkHash === undefined) {
    throw new Error(
      "Wallet clients require a validated client or an explicit networkHash",
    );
  }
  const signingNetworkHash = toNetworkHash(
    sha256Hash(new Uint8Array(sourceNetworkHash)),
  );
  if (walletClientMarker in client) {
    throw new Error("A client can only be bound to one wallet account");
  }
  const collision = reservedWalletClientProperties.find(
    (property) => property in client,
  );
  if (collision) {
    throw new Error(
      `Client property ${collision} conflicts with a wallet client property`,
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
    getBalance: (address = account.address, options) =>
      getBalance(address, options),
    prepareTransaction: (request) =>
      prepareTransaction(client, account, request),
    signTransaction: (transaction) =>
      signWalletTransaction(account, transaction, signingNetworkHash),
    sendInvocation: (request) =>
      sendInvocation(client, account, signingNetworkHash, request),
    prepareDeployment: (deployment, gasLimit) =>
      prepareTransaction(
        client,
        account,
        deploymentRequest(
          deployment,
          account.address,
          gasLimit,
          requireDeploymentAdapter(),
        ),
      ),
    deployContract: async (deployment, gasLimit) => {
      const request = deploymentRequest(
        deployment,
        account.address,
        gasLimit,
        requireDeploymentAdapter(),
      );
      const address = deployment.address.slice() as ContractAddress;
      return {
        txHash: await sendInvocation(
          client,
          account,
          signingNetworkHash,
          request,
        ),
        address,
      };
    },
    deployContractAndWait: async (deployment, gasLimit, wait) => {
      const adapter = requireDeploymentAdapter();
      const address = deployment.address.slice() as ContractAddress;
      const result = await sendAndObserve(
        deploymentRequest(deployment, account.address, gasLimit, adapter),
        wait,
      );
      decodeDeployment(result.receipt, { ...deployment, address }, adapter);
      return { ...result, address };
    },
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
  function requireDeploymentAdapter(): WalletInvocationAdapter {
    if (!invocationAdapter)
      throw new Error("Wallet requires an adapter for deployment");
    return invocationAdapter as WalletInvocationAdapter;
  }
  async function sendAndObserve(
    request: PrepareTransactionRequest,
    wait?: WaitForTransactionReceiptOptions,
  ): Promise<ExecutionResult> {
    wait?.signal?.throwIfAborted();
    const transaction = await prepareTransaction(client, account, request);
    const signed = await signWalletTransaction(
      account,
      transaction,
      signingNetworkHash,
    );
    wait?.signal?.throwIfAborted();
    return submitAndObserve(
      client,
      hashSignedTransaction(signed),
      () => client.sendTransaction(signed),
      { ...wait, expectedNetworkHash: signingNetworkHash },
    );
  }
  const execution = invocationAdapter
    ? {
        async executeCallsAndWait<T extends readonly ContractCall[]>(
          request: ExecuteCallsRequest<T>,
          wait?: WaitForTransactionReceiptOptions,
        ) {
          const calls = [...request.calls];
          if (calls.length === 0)
            throw new RangeError("Execution requires at least one call");
          const invocations = calls.map((call) => call.invocation);
          const invocation =
            calls.length === 1
              ? invocationAdapter.createRootInvocation(account.address, {
                  ...request,
                  invocation: invocations[0]!,
                } as never)
              : invocationAdapter.createBatchRootInvocation?.(account.address, {
                  ...request,
                  invocations,
                });
          if (!invocation)
            throw new Error("Wallet adapter does not support atomic batches");
          const result = await sendAndObserve(
            {
              ...request,
              invocation,
            },
            wait,
          );
          return {
            ...result,
            values: decodeExecution(
              result.receipt,
              calls,
              requireDeploymentAdapter(),
            ) as CallResults<T>,
          };
        },
        prepareExecution: (request: PrepareExecutionRequest) =>
          prepareTransaction(client, account, {
            ...request,
            invocation: invocationAdapter.createRootInvocation(
              account.address,
              request as never,
            ),
          }),
        execute: (request: PrepareExecutionRequest) =>
          sendInvocation(client, account, signingNetworkHash, {
            ...request,
            invocation: invocationAdapter.createRootInvocation(
              account.address,
              request as never,
            ),
          }),
        executeAndWait: async (
          request: PrepareExecutionRequest,
          wait?: WaitForTransactionReceiptOptions,
        ) => {
          const result = await sendAndObserve(
            {
              ...request,
              invocation: invocationAdapter.createRootInvocation(
                account.address,
                request as never,
              ),
            },
            wait,
          );
          assertTransactionSuccess(result.receipt);
          return result;
        },
      }
    : {};

  const wallet = Object.assign(
    {},
    client,
    walletActions,
    airdrop,
    execution,
  ) as WalletClient<TClient, TAccount>;
  Object.defineProperty(wallet, walletClientMarker, { value: true });
  return wallet;
}

function getConnectedNetworkHash(
  client: CoreGroundhogClient,
): NetworkHash | undefined {
  if (!("network" in client)) return undefined;
  const network = client.network;
  if (!network || typeof network !== "object" || !("networkHash" in network)) {
    return undefined;
  }
  return network.networkHash as NetworkHash;
}
