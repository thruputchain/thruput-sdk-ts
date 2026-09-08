import {
  AuthClaimType,
  CryptographicScheme,
  codec,
  contractAddress,
  deserialize,
  ed25519PublicKey,
  fromHex,
  serialize,
  type Transaction,
} from "@groundhogchain/protocol";
import type { CoreGroundhogClient } from "../client.js";
import { toHex0x } from "../actions/hex.js";
import { prepareTransaction } from "../actions/wallet/prepareTransaction.js";
import {
  WalletProviderError,
  assertWalletTransaction,
  parseSignTransactionResult,
  parseSubmitTransactionResult,
  parseTransactionHex,
  parseWalletAccount,
  parseWalletNetworkHash,
  parseWalletProvider,
  parseWalletProviderError,
  parseWalletSession,
  verifySignTransactionResult,
  type ProviderRequest,
  type SignTransactionResult,
  type SubmitTransactionResult,
  type WalletAccount,
  type WalletProvider,
} from "../provider/index.js";
import type { PrepareExecutionRequest } from "./client.js";
import { defaultWalletAdapter } from "./invocationAdapter.js";

/** External wallet binding. Network hash uses the provider wire format, without 0x. */
export interface CreateProviderWalletClientOptions {
  client: CoreGroundhogClient;
  provider: WalletProvider;
  account: WalletAccount;
  networkHash: string;
}

/** Explicit prepare/sign/persist/submit flow without access to a raw signer. */
export interface ProviderWalletClient {
  prepareExecution(request: PrepareExecutionRequest): Promise<Transaction>;
  signTransaction(transaction: Transaction): Promise<SignTransactionResult>;
  submitTransaction(
    signed: SignTransactionResult,
  ): Promise<SubmitTransactionResult>;
  dispose(): void;
}

/** Bind a pubkey provider account without modifying the public RPC client. */
export function createProviderWalletClient(
  options: CreateProviderWalletClientOptions,
): ProviderWalletClient {
  const { client } = options;
  const provider = parseWalletProvider(options.provider);
  const account = parseWalletAccount(options.account);
  const networkHash = parseWalletNetworkHash(options.networkHash);
  if ("network" in client) {
    const network = client.network;
    if (
      !network ||
      typeof network !== "object" ||
      !("networkHash" in network) ||
      !(network.networkHash instanceof Uint8Array) ||
      toHex0x(network.networkHash) !== `0x${networkHash}`
    ) {
      throw new WalletProviderError(
        4901,
        "Client and provider network hashes differ",
      );
    }
  }
  const preparationAccount = {
    address: contractAddress(fromHex(account.address.slice(2))),
    authClaim: {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: {
        pubkey: {
          scheme: CryptographicScheme.Ed25519,
          ed25519: ed25519PublicKey(fromHex(account.publicKey.slice(2))),
        },
        nonce: BigInt(account.nonce),
      },
    },
  } as const;
  const providerRequest = provider.request.bind(provider);
  let invalidated = false;
  let busy = false;
  let sessionSnapshot: string | undefined;
  let approved: SignTransactionResult | undefined;
  const invalidate = () => {
    invalidated = true;
    approved = undefined;
  };
  const unsubscribe = provider.on("change", invalidate);
  if (typeof unsubscribe !== "function") {
    throw new WalletProviderError(
      -32603,
      "Provider did not return an unsubscribe function",
    );
  }
  let disposed = false;

  function assertActive(): void {
    if (invalidated)
      throw new WalletProviderError(
        4100,
        "Wallet session changed or adapter was disposed",
      );
  }

  async function request(value: ProviderRequest): Promise<unknown> {
    assertActive();
    try {
      return await providerRequest(value);
    } catch (error) {
      let failure: WalletProviderError;
      try {
        failure = parseWalletProviderError(error);
      } catch {
        failure = new WalletProviderError(
          4900,
          "Wallet provider request failed",
        );
      }
      if ([4100, 4900, 4901].includes(failure.code)) invalidate();
      throw failure;
    }
  }

  async function checkSession(): Promise<void> {
    try {
      const value = await request({ method: "getSession" });
      assertActive();
      let session;
      try {
        session = parseWalletSession(value);
      } catch {
        throw new WalletProviderError(-32603, "Invalid provider session");
      }
      if (session.networkHash !== networkHash) {
        throw new WalletProviderError(4901, "Wallet network changed");
      }
      if (
        !session.accounts.some(
          (entry) =>
            entry.address === account.address &&
            entry.publicKey === account.publicKey &&
            entry.nonce === account.nonce,
        )
      ) {
        throw new WalletProviderError(4100, "Wallet account is not authorized");
      }
      const snapshot = JSON.stringify(session);
      if (sessionSnapshot !== undefined && sessionSnapshot !== snapshot) {
        throw new WalletProviderError(4100, "Wallet session changed");
      }
      sessionSnapshot = snapshot;
    } catch (error) {
      invalidate();
      throw error;
    }
  }

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    assertActive();
    if (busy)
      throw new WalletProviderError(
        -32002,
        "Another wallet operation is pending",
      );
    busy = true;
    try {
      const result = await operation();
      assertActive();
      return result;
    } finally {
      busy = false;
    }
  }

  return {
    prepareExecution: (input) =>
      run(async () => {
        const preparation = {
          ...input,
          invocation: defaultWalletAdapter.createRootInvocation(
            preparationAccount.address,
            input,
          ),
          contractsToDeploy: input.contractsToDeploy?.map((contract) =>
            deserialize(serialize(contract, codec.Contract), codec.Contract),
          ),
        };
        await checkSession();
        const tx = await prepareTransaction(
          client,
          preparationAccount,
          preparation,
        );
        assertActive();
        // Enforce the same boundary before returning a locally prepared transaction.
        return parseTransactionHex(toHex0x(serialize(tx, codec.Transaction)));
      }),
    signTransaction: (input) =>
      run(async () => {
        const transaction = toHex0x(serialize(input, codec.Transaction));
        assertWalletTransaction(parseTransactionHex(transaction), account);
        approved = undefined;
        await checkSession();
        const value = await request({
          method: "signTransaction",
          params: { account: account.address, networkHash, transaction },
        });
        assertActive();
        let signed: SignTransactionResult;
        try {
          signed = await verifySignTransactionResult(
            value,
            transaction,
            account,
            networkHash,
          );
        } catch (error) {
          invalidate();
          throw error;
        }
        await checkSession();
        assertActive();
        approved = signed;
        return signed;
      }),
    submitTransaction: (input) =>
      run(async () => {
        const signed = parseSignTransactionResult(input);
        if (
          !approved ||
          approved.signedTransaction !== signed.signedTransaction ||
          approved.hash !== signed.hash
        ) {
          throw new WalletProviderError(
            4100,
            "Signed bytes were not approved by this adapter",
          );
        }
        await checkSession();
        // Consume before crossing the broadcast boundary, including ambiguous failures.
        approved = undefined;
        const value = await request({
          method: "submitTransaction",
          params: {
            account: account.address,
            networkHash,
            signedTransaction: signed.signedTransaction,
          },
        });
        assertActive();
        let result: SubmitTransactionResult;
        try {
          result = parseSubmitTransactionResult(value);
          if (result.hash !== signed.hash) throw new Error("Hash mismatch");
        } catch {
          invalidate();
          throw new WalletProviderError(
            -32603,
            "Provider submission hash mismatch; broadcast may have occurred",
          );
        }
        await checkSession();
        return Object.freeze(result);
      }),
    dispose() {
      invalidate();
      if (!disposed) {
        disposed = true;
        unsubscribe();
      }
    },
  };
}
