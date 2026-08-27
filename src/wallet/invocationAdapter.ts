import {
  codec,
  contractAddress,
  serialize,
  type ContractAddress,
  type GasAmount,
  type Invocation,
} from "@groundhogchain/protocol";
import { fixedBytes } from "@groundhogchain/xdr";
import { DefaultWallet } from "../contracts/default_wallet.js";
import { DevWallet } from "../contracts/dev_wallet.js";

/** Common inputs for wrapping one inner invocation through a wallet contract. */
export interface WalletExecutionRequest {
  readonly invocation: Invocation;
  /** Gas available to the wallet's root invocation. */
  readonly gasLimit: GasAmount;
}

/** Converts a wallet-specific execution request into a root invocation. */
export interface WalletInvocationAdapter<
  TRequest extends WalletExecutionRequest = WalletExecutionRequest,
> {
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
  createRootInvocation(
    accountAddress: ContractAddress,
    request: WalletExecutionRequest,
  ): Invocation {
    const inner = request.invocation;
    return DefaultWallet.execute.invocation(
      contractAddress(new Uint8Array(accountAddress)),
      request.gasLimit,
      {
        calls: [
          {
            target: contractAddress(new Uint8Array(inner.invoked_address)),
            entrypoint: fixedBytes(new Uint8Array(inner.entrypoint), 8),
            gas_limit: inner.gas_limit,
            calldata: new Uint8Array(inner.calldata),
          },
        ],
      },
    );
  },
});

/** Wrap one call through the local-development DevWallet interface. */
export const devWalletAdapter = defineWalletInvocationAdapter({
  createRootInvocation(
    accountAddress: ContractAddress,
    request: WalletExecutionRequest,
  ): Invocation {
    return DevWallet.doAction.invocation(
      contractAddress(new Uint8Array(accountAddress)),
      request.gasLimit,
      {
        invocationBytes: serialize(request.invocation, codec.Invocation),
      },
    );
  },
});
