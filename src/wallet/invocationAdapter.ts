import {
  codec,
  contractAddress,
  serialize,
  type ContractAddress,
  type GasAmount,
  type Invocation,
} from "@thruputchain/protocol";
import { fixedBytes } from "@thruputchain/xdr";
import { bytesEqual } from "../contract/event.js";
import { DefaultWallet } from "../contracts/default_wallet.js";
import { DevWallet } from "../contracts/dev_wallet.js";
import { MAX_DEFAULT_WALLET_CALLS } from "../provider/validation.js";
import type { ContractDeployment, DeploymentOptions } from "./deployment.js";
import type { TransactionReceipt } from "../types/rpc.js";

/** Common inputs for wrapping one inner invocation through a wallet contract. */
export interface WalletExecutionRequest {
  readonly invocation: Invocation;
  /** Gas available to the wallet's root invocation. */
  readonly gasLimit: GasAmount;
}

/** Ordered inner calls for one atomic DefaultWallet execution. */
export interface WalletBatchExecutionRequest {
  readonly invocations: readonly Invocation[];
  /** Gas available to the complete wallet root, including all calls. */
  readonly gasLimit: GasAmount;
}

/** Build a root batch directly, copying call bytes before asynchronous work. */
export function createDefaultWalletBatchInvocation(
  accountAddress: ContractAddress,
  request: WalletBatchExecutionRequest,
): Invocation {
  if (
    !Array.isArray(request.invocations) ||
    request.invocations.length < 1 ||
    request.invocations.length > MAX_DEFAULT_WALLET_CALLS
  )
    throw new RangeError("DefaultWallet requires 1 to 16 calls");
  return DefaultWallet.v0_1.execute.invocation(
    contractAddress(new Uint8Array(accountAddress)),
    request.gasLimit,
    {
      calls: request.invocations.map((inner) => ({
        target: contractAddress(new Uint8Array(inner.invoked_address)),
        entrypoint: fixedBytes(new Uint8Array(inner.entrypoint), 8),
        gas_limit: inner.gas_limit,
        calldata: new Uint8Array(inner.calldata),
      })),
    },
  );
}

/** Converts a wallet-specific execution request into a root invocation. */
export interface WalletInvocationAdapter<
  TRequest extends WalletExecutionRequest = WalletExecutionRequest,
> {
  /** Build a root deployment when supported by this wallet. */
  createDeploymentInvocation?(
    account: ContractAddress,
    deployment: ContractDeployment,
    options: DeploymentOptions,
  ): Invocation;
  /** Decode the address returned by a root deployment. */
  decodeDeploymentReceipt?(receipt: TransactionReceipt): ContractAddress;
  /** Child return buffers in call order, or null when this wallet discards them. */
  decodeExecutionReturns?(
    receipt: TransactionReceipt,
  ): readonly Uint8Array[] | null;
  /** Build one atomic root for multiple calls when this wallet supports it. */
  createBatchRootInvocation?(
    account: ContractAddress,
    request: WalletBatchExecutionRequest,
  ): Invocation;
  createRootInvocation(
    accountAddress: ContractAddress,
    request: TRequest,
  ): Invocation;
}

/** Define an invocation adapter while preserving its request type. */
export function defineWalletInvocationAdapter<
  TRequest extends WalletExecutionRequest,
>(
  adapter: WalletInvocationAdapter<TRequest>,
): WalletInvocationAdapter<TRequest> {
  return adapter;
}

/** Wrap one call through the native-compatible DefaultWallet interface. */
export const defaultWalletAdapter = defineWalletInvocationAdapter({
  createBatchRootInvocation: createDefaultWalletBatchInvocation,
  decodeExecutionReturns: (receipt) =>
    DefaultWallet.v0_1.execute.decodeReceipt(receipt).value,
  createDeploymentInvocation(account, deployment, options) {
    if (
      options.initializer &&
      !bytesEqual(options.initializer.invoked_address, deployment.address)
    )
      throw new Error(
        "Initializer must target the predicted deployment address",
      );
    return DefaultWallet.v0_1.deploy.invocation(account, options.gasLimit, {
      nonce: fixedBytes(deployment.deploymentNonce, 32),
      contractHash: fixedBytes(deployment.contractHash, 32),
      amount: options.amount,
      initializer: options.initializer
        ? {
            entrypoint: fixedBytes(options.initializer.entrypoint, 8),
            gas_limit: options.initializer.gas_limit,
            calldata: options.initializer.calldata,
          }
        : null,
    });
  },
  decodeDeploymentReceipt: (receipt) =>
    DefaultWallet.v0_1.deploy.decodeReceipt(receipt).value,
  createRootInvocation(
    accountAddress: ContractAddress,
    request: WalletExecutionRequest,
  ): Invocation {
    return createDefaultWalletBatchInvocation(accountAddress, {
      invocations: [request.invocation],
      gasLimit: request.gasLimit,
    });
  },
});

/** Wrap one call through the legacy DevWallet. Unified deployment is unsupported. */
export const devWalletAdapter = defineWalletInvocationAdapter({
  decodeExecutionReturns: () => null,
  createRootInvocation(
    accountAddress: ContractAddress,
    request: WalletExecutionRequest,
  ): Invocation {
    return DevWallet.v0_1.doAction.invocation(
      contractAddress(new Uint8Array(accountAddress)),
      request.gasLimit,
      {
        invocationBytes: serialize(request.invocation, codec.Invocation),
      },
    );
  },
});
