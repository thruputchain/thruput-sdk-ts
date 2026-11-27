import {
  codec,
  contractEntrypointID,
  deserialize,
  gasAmount,
  calldata,
  sha256Hash,
  type AuthTokenNode,
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

/** A mint in its original position, including the bytes of an unreadable grant. */
export type WalletMint =
  | { kind: "decoded"; node: AuthTokenNode }
  | { kind: "unreadable"; bytes: Uint8Array };

/** Calls and grants requested by a wallet root, in calldata order. */
export interface WalletRequestDescription {
  wrapper: WalletRequests["wrapper"];
  mints: WalletMint[];
  calls: {
    invocation: Invocation;
    /** Ordered references to mints or to tokens returned by earlier calls. */
    tokens: DefaultWallet.v0_1.ExecuteArgs["calls"][number]["tokens"];
  }[];
}

/**
 * Describe the grants and calls in a known DefaultWallet root before execution.
 * The caller must establish wallet identity. An unknown selector returns null;
 * malformed wrapper calldata throws. An unreadable mint retains its bytes and
 * position. Token references describe requests; they do not establish that a
 * token exists or will be returned.
 */
export function describeDefaultWalletRequests(
  root: Invocation,
): WalletRequestDescription | null {
  const requests = readWalletRequests(root);
  if (!requests) return null;
  return { ...requests, mints: requests.mints.map(decodeMint) };
}

function decodeMint(bytes: Uint8Array): WalletMint {
  try {
    return { kind: "decoded", node: deserialize(bytes, codec.AuthTokenNode) };
  } catch {
    return { kind: "unreadable", bytes };
  }
}

/**
 * Interpret a known DefaultWallet root using built-in binding descriptors.
 * Call only after identifying the root as DefaultWallet; matching selectors
 * alone do not establish wallet identity. Malformed recognized inputs throw,
 * as does an `execute` that mints or forwards auth tokens. To read grants,
 * use {@link describeDefaultWalletRequests}.
 */
export function decodeDefaultWalletRequests(
  root: Invocation,
): WalletRequests | null {
  const requests = readWalletRequests(root);
  if (!requests) return null;
  if (
    requests.mints.length ||
    requests.calls.some((call) => call.tokens.length)
  )
    throw new Error(
      "DefaultWallet.execute mints or forwards auth tokens, which requested calls cannot represent",
    );
  return {
    wrapper: requests.wrapper,
    requestedCalls: requests.calls.map((call) => call.invocation),
  };
}

function readWalletRequests(root: Invocation): {
  wrapper: WalletRequests["wrapper"];
  calls: WalletRequestDescription["calls"];
  mints: Uint8Array[];
} | null {
  if (bytesEqual(root.entrypoint, DefaultWallet.v0_1.execute.entrypoint)) {
    const { mints, calls } = DefaultWallet.v0_1.execute.decodeArgs(
      root.calldata,
    );
    return {
      wrapper: "DefaultWallet.execute",
      mints,
      calls: calls.map((call) => ({
        invocation: {
          invoked_address: call.target,
          entrypoint: contractEntrypointID(call.entrypoint),
          gas_limit: gasAmount(call.gas_limit),
          calldata: calldata(call.calldata),
        },
        tokens: call.tokens,
      })),
    };
  }
  if (bytesEqual(root.entrypoint, DefaultWallet.v0_1.deploy.entrypoint)) {
    const args = DefaultWallet.v0_1.deploy.decodeArgs(root.calldata);
    const init = args.initializer;
    return {
      wrapper: "DefaultWallet.deploy",
      mints: [],
      calls: init
        ? [
            {
              tokens: [],
              invocation: {
                invoked_address: deriveContractAddress(
                  root.invoked_address,
                  sha256Hash(args.nonce),
                  sha256Hash(args.contractHash),
                ),
                entrypoint: contractEntrypointID(init.entrypoint),
                gas_limit: gasAmount(init.gas_limit),
                calldata: calldata(init.calldata),
              },
            },
          ]
        : [],
    };
  }
  return null;
}
