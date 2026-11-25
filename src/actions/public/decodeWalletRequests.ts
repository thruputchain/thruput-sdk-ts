import {
  contractEntrypointID,
  gasAmount,
  calldata,
  sha256Hash,
  type Invocation,
} from "@thruputchain/protocol";
import { DefaultWallet } from "../../contracts/default_wallet.js";
import { bytesEqual } from "../../contract/event.js";
import { deriveContractAddress } from "../../derivation/contractAddress.js";

/** Requested child invocations, never proof of execution or child outputs. */
export interface WalletRequests {
  wrapper: "DefaultWallet.execute" | "DefaultWallet.deploy";
  requestedCalls: Invocation[];
}

/**
 * Interpret a known DefaultWallet root using built-in binding descriptors.
 * Call only after identifying the root as DefaultWallet; matching selectors
 * alone do not establish wallet identity. Malformed recognized inputs throw,
 * as does an `execute` that mints or forwards auth tokens.
 */
export function decodeDefaultWalletRequests(
  root: Invocation,
): WalletRequests | null {
  if (bytesEqual(root.entrypoint, DefaultWallet.v0_1.execute.entrypoint)) {
    const { mints, calls } = DefaultWallet.v0_1.execute.decodeArgs(
      root.calldata,
    );
    // An `Invocation` cannot say that the wallet mints auth tokens or forwards
    // them to a call, so refuse such a root instead of under-reporting it.
    if (mints.length > 0 || calls.some((call) => call.tokens.length > 0))
      throw new Error(
        "DefaultWallet.execute mints or forwards auth tokens, which requested calls cannot represent",
      );
    return {
      wrapper: "DefaultWallet.execute",
      requestedCalls: calls.map((call) => ({
        invoked_address: call.target,
        entrypoint: contractEntrypointID(call.entrypoint),
        gas_limit: gasAmount(call.gas_limit),
        calldata: calldata(call.calldata),
      })),
    };
  }
  if (bytesEqual(root.entrypoint, DefaultWallet.v0_1.deploy.entrypoint)) {
    const args = DefaultWallet.v0_1.deploy.decodeArgs(root.calldata);
    const init = args.initializer;
    return {
      wrapper: "DefaultWallet.deploy",
      requestedCalls: init
        ? [
            {
              invoked_address: deriveContractAddress(
                root.invoked_address,
                sha256Hash(args.nonce),
                sha256Hash(args.contractHash),
              ),
              entrypoint: contractEntrypointID(init.entrypoint),
              gas_limit: gasAmount(init.gas_limit),
              calldata: calldata(init.calldata),
            },
          ]
        : [],
    };
  }
  return null;
}
