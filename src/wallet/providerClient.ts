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
  parseWalletCapabilities,
  type WalletCapabilities,
  verifySignTransactionResult,
  type ProviderRequest,
  type SignTransactionResult,
  type SubmitTransactionResult,
  type WalletAccount,
  type WalletProvider,
} from "../provider/index.js";
import type { PrepareExecutionRequest } from "./client.js";
import {
  defaultWalletAdapter,
  createDefaultWalletBatchInvocation,
  type WalletBatchExecutionRequest,
} from "./invocationAdapter.js";

/** Root options and ordered calls for atomic provider-wallet execution. */
export type PrepareBatchExecutionRequest = WalletBatchExecutionRequest &
  Omit<PrepareExecutionRequest, "invocation">;

/** External wallet binding. Network hash uses the provider wire format, without 0x. */
export interface CreateProviderWalletClientOptions {
  /**
   * RPC client connected to and verified against the application's expected network.
   * A validated client identity must match `networkHash`; an unqualified
   * CoreGroundhogClient requires the caller to verify its RPC network separately.
   */
  client: CoreGroundhogClient;
  /** Live external provider with an already authorized session. */
  provider: WalletProvider;
  /** Wire pubkey account from the provider subpath, snapshotted at construction. */
  account: WalletAccount;
  /** Trusted application network identity: 64 lowercase hex characters without 0x; must match the session. */
  networkHash: string;
}

/**
 * Explicit prepare/sign/persist/submit flow without access to a raw signer.
 * Allows one in-flight operation; concurrent calls fail with code -32002. Checks
 * `getSession` before each operation and permanently invalidates on every `change`,
 * a failed session read, or a mismatched session. Dispose and recreate after a
 * change or reconnect; there is no automatic reconnect or retry.
 *
 * @see https://docs.groundhog.dev/tools/wallet-integration/
 */
export interface ProviderWalletClient {
  /** Read fresh account/network capabilities; only 4200 falls back to unsupported. */
  getCapabilities(): Promise<WalletCapabilities>;
  /** Prepare one atomic batch after checking support. Does not sign or submit. */
  prepareBatchExecution(
    request: PrepareBatchExecutionRequest,
  ): Promise<Transaction>;
  /**
   * Prepare a transaction using the default-wallet wrapper and existing nonce and
   * expiry handling. Generates a random transaction nonce when none is supplied;
   * this is separate from the account-derivation nonce. Snapshots input before
   * asynchronous work and enforces the unsigned size bound. Does not sign or submit.
   */
  prepareExecution(request: PrepareExecutionRequest): Promise<Transaction>;
  /**
   * Request approval and sign without broadcasting. Snapshots the unsigned bytes,
   * checks the account claim, and verifies exact bytes, strict network-bound
   * signature, and canonical hash with {@link verifySignTransactionResult}.
   * Once a new request passes local transaction and account-claim validation, it
   * clears the previous approval before awaiting the session or provider. Failure
   * or user rejection does not restore that approval. Only the latest successfully
   * verified result can be submitted; invalid provider results invalidate the adapter.
   * Await durable persistence of the result,
   * account, and network before calling {@link submitTransaction}.
   */
  signTransaction(transaction: Transaction): Promise<SignTransactionResult>;
  /**
   * Submit the exact signed bytes and hash of this adapter's latest approval.
   * Consumes approval before requesting broadcast, including when that request
   * fails; the adapter never retries. Returns a broadcast acknowledgement, not an
   * execution receipt, and verifies its hash against the approved result.
   *
   * Treat a submit failure as potentially broadcast. Keep the previously persisted
   * hash and query status/receipt on the original network; do not automatically
   * prepare, sign, or execute a replacement transaction. A timeout, session change,
   * or invalid response can occur after broadcast. See the factory's persistence example.
   */
  submitTransaction(
    signed: SignTransactionResult,
  ): Promise<SubmitTransactionResult>;
  /**
   * Idempotently unsubscribe and permanently invalidate this adapter, clearing its
   * approval. Does not revoke provider permission or cancel pending requests.
   * A late response cannot reactivate the adapter. Use provider `disconnect` to
   * revoke permission; create a new adapter for a later authorized session.
   */
  dispose(): void;
}

/**
 * Synchronously bind a pubkey provider account without modifying the RPC client.
 * Does not connect or request permission: first await provider `connect` and
 * validate its session. Snapshots account/network configuration, validates account
 * derivation and any validated client network identity, and subscribes to changes.
 * Supply the application's trusted expected network hash, not a value adopted from
 * the wallet. The RPC client must be connected to and verified against that same
 * network. An unqualified CoreGroundhogClient carries no validated network identity;
 * the caller must verify its RPC network separately before creating this adapter.
 * See {@link ProviderWalletClient} for invalidation and concurrency rules.
 * Providers own request deadlines; this adapter adds no UI timeout or cancellation.
 *
 * @example
 * Await an application-owned `onSigned` callback to durably save the signed result
 * and its original account/network before broadcasting. If saving fails, submission
 * is never requested. `onSigned` is an application callback, not an SDK option.
 * `expectedNetworkHash` comes from trusted application configuration, and `client`
 * must already be connected to and verified against that network.
 *
 * ```ts
 * import type { CoreGroundhogClient } from "@groundhogchain/client";
 * import {
 *   parseWalletSession,
 *   parseWalletNetworkHash,
 *   type SignTransactionResult,
 *   type WalletAccount,
 *   type WalletProvider,
 * } from "@groundhogchain/client/provider";
 * import {
 *   createProviderWalletClient,
 *   type PrepareExecutionRequest,
 * } from "@groundhogchain/client/wallet";
 *
 * async function sendWithWallet(
 *   client: CoreGroundhogClient,
 *   provider: WalletProvider,
 *   expectedNetworkHash: string,
 *   request: PrepareExecutionRequest,
 *   onSigned: (pending: SignTransactionResult & {
 *     account: WalletAccount;
 *     networkHash: string;
 *   }) => Promise<void>,
 * ) {
 *   const networkHash = parseWalletNetworkHash(expectedNetworkHash);
 *   const session = parseWalletSession(await provider.request({ method: "connect" }));
 *   if (session.networkHash !== networkHash) {
 *     throw new Error("Wallet network does not match the application network");
 *   }
 *   const account = session.accounts[0];
 *   if (!account) throw new Error("No authorized account");
 *   const wallet = createProviderWalletClient({
 *     client, provider, account, networkHash,
 *   });
 *   try {
 *     const transaction = await wallet.prepareExecution(request);
 *     const signed = await wallet.signTransaction(transaction);
 *     await onSigned({ ...signed, account, networkHash });
 *     // On submit failure, recover using the saved hash and original network.
 *     return await wallet.submitTransaction(signed);
 *   } finally {
 *     wallet.dispose();
 *   }
 * }
 * ```
 *
 * @see https://docs.groundhog.dev/tools/wallet-integration/
 * @see https://docs.groundhog.dev/tools/wallet-provider/
 */
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
  const supportsCapabilities =
    provider.supportedMethods?.includes("getCapabilities") ?? false;
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

  async function readCapabilities(): Promise<WalletCapabilities> {
    await checkSession();
    if (!supportsCapabilities) {
      return Object.freeze({
        account: account.address,
        networkHash,
        atomicBatch: null,
      });
    }
    let value: unknown;
    try {
      value = await request({
        method: "getCapabilities",
        params: { account: account.address, networkHash },
      });
    } catch (error) {
      if (!(error instanceof WalletProviderError) || error.code !== 4200)
        throw error;
      value = { account: account.address, networkHash, atomicBatch: null };
    }
    assertActive();
    let capabilities: WalletCapabilities;
    try {
      capabilities = parseWalletCapabilities(value);
      if (
        capabilities.account !== account.address ||
        capabilities.networkHash !== networkHash
      )
        throw new Error("Capability scope mismatch");
    } catch {
      invalidate();
      throw new WalletProviderError(-32603, "Invalid provider capabilities");
    }
    await checkSession();
    assertActive();
    if (capabilities.atomicBatch) Object.freeze(capabilities.atomicBatch);
    return Object.freeze(capabilities);
  }

  return {
    getCapabilities: () => run(readCapabilities),
    prepareBatchExecution: (input) =>
      run(async () => {
        const count = input.invocations.length;
        const preparation = {
          ...input,
          invocation: createDefaultWalletBatchInvocation(
            preparationAccount.address,
            input,
          ),
          contractsToDeploy: input.contractsToDeploy?.map((contract) =>
            deserialize(serialize(contract, codec.Contract), codec.Contract),
          ),
        };
        const capabilities = await readCapabilities();
        if (
          !capabilities.atomicBatch ||
          count > capabilities.atomicBatch.maxCalls
        )
          throw new WalletProviderError(
            4200,
            "Atomic batch execution is not supported for these calls",
          );
        const tx = await prepareTransaction(
          client,
          preparationAccount,
          preparation,
        );
        assertActive();
        return parseTransactionHex(toHex0x(serialize(tx, codec.Transaction)));
      }),
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
