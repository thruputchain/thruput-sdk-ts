import { isBytes } from "@noble/hashes/utils.js";
import {
  AuthClaimType,
  CryptographicScheme,
  codec,
  contractAddress,
  deserialize,
  ed25519PublicKey,
  serialize,
  type Transaction,
  type GasAmount,
} from "@thruputchain/protocol";
import { fixedFromBase58, hashFromBase58, toBase58 } from "../encoding.js";
import {
  submitAndObserve,
  createSubmissionEvidence,
  TransactionObservationError,
  assertTransactionSuccess,
  decodeExecution,
  type CallResults,
  type ExecutionResult,
} from "./execution.js";
import type { ContractCall } from "../contract/method.js";
import type { WaitForTransactionReceiptOptions } from "../actions/public/waitForTransactionReceipt.js";
import {
  deploymentRequest,
  decodeDeployment,
  type ContractDeployment,
  type DeploymentOptions,
} from "./deployment.js";
import type { CoreThruputClient } from "../client.js";
import { toHex0x } from "../actions/hex.js";
import { pubkeyAccountPreimage } from "../derivation/pubkeyAccount.js";
import { prepareTransaction } from "../actions/wallet/prepareTransaction.js";
import {
  WalletProviderError,
  assertWalletTransaction,
  parseSignTransactionResult,
  parseSubmitTransactionResult,
  parseTransactionHex,
  parseSignedTransactionHex,
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

/** Exact signed evidence available before broadcasting. Persist on the original network. */
export interface PendingWalletTransaction extends SignTransactionResult {
  readonly account: WalletAccount;
  readonly networkHash: string;
}

/** Lifecycle controls. Cancellation can prevent dispatch; it never cancels a broadcast already sent. */
export interface ProviderExecutionOptions {
  /** Await durable application persistence before submitting; rejection prevents broadcast. */
  onSigned: (pending: PendingWalletTransaction) => void | Promise<void>;
  /** Shared submission/receipt budget after signing and persistence; network identity is pinned. */
  wait?: WaitForTransactionReceiptOptions;
}

/** Typed calls executed atomically through DefaultWallet. */
export interface ExecuteCallsRequest<T extends readonly ContractCall[]> {
  calls: T;
  gasLimit: GasAmount;
  contractsToDeploy?: PrepareExecutionRequest["contractsToDeploy"];
  expiryBlocks?: bigint;
}

/** External wallet binding. Network hash uses unprefixed, case-sensitive base58. */
export interface CreateProviderWalletClientOptions {
  /**
   * RPC client connected to and verified against the application's expected network.
   * A validated client identity must match `networkHash`; an unqualified
   * CoreThruputClient requires the caller to verify its RPC network separately.
   */
  client: CoreThruputClient;
  /** Live external provider with an already authorized session. */
  provider: WalletProvider;
  /** Wire pubkey account from the provider subpath, snapshotted at construction. */
  account: WalletAccount;
  /** Trusted application network identity: 32-byte base58; must match the session exactly. */
  networkHash: string;
}

/**
 * Explicit prepare/sign/persist/submit flow without access to a raw signer.
 * Allows one in-flight operation; concurrent calls fail with code -32002. Checks
 * `getSession` before each operation and permanently invalidates on every `change`,
 * a failed session read, or a mismatched session. Dispose and recreate after a
 * change or reconnect; there is no automatic reconnect or retry.
 *
 * @see https://docs.thruput.network/tools/wallet-integration/
 */
export interface ProviderWalletClient {
  /** Prepare a root deployment, preserving the explicit signing boundary. */
  prepareDeployment(
    deployment: ContractDeployment,
    options: DeploymentOptions,
  ): Promise<Transaction>;
  /** Persist approved evidence, deploy once, and verify the committed address. */
  deployContractAndWait(
    deployment: ContractDeployment,
    options: DeploymentOptions,
    controls: ProviderExecutionOptions,
  ): Promise<
    ExecutionResult & {
      address: import("@thruputchain/protocol").ContractAddress;
    }
  >;
  /** Prepare, sign, persist, submit once, then observe a successful receipt. */
  executeAndWait(
    request: PrepareExecutionRequest,
    options: ProviderExecutionOptions,
  ): Promise<ExecutionResult>;
  /** Execute an ordered atomic batch and decode typed child results. */
  executeCallsAndWait<T extends readonly ContractCall[]>(
    request: ExecuteCallsRequest<T>,
    options: ProviderExecutionOptions,
  ): Promise<ExecutionResult & { values: CallResults<T> }>;
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
 * network. Every native client carries a discovered network identity, checked here.
 * See {@link ProviderWalletClient} for invalidation and concurrency rules.
 * Providers own signing UI deadlines. Execution controls bound submission and
 * observation after signing; they cannot cancel a broadcast already sent.
 *
 * @example
 * Await an application-owned `onSigned` callback to durably save the signed result
 * and its original account/network before broadcasting. If saving fails, submission
 * is never requested.
 * `expectedNetworkHash` comes from trusted application configuration, and `client`
 * must already be connected to and verified against that network.
 *
 * ```ts
 * import type { CoreThruputClient } from "@thruputchain/client";
 * import {
 *   parseWalletSession,
 *   parseWalletNetworkHash,
 *   type SignTransactionResult,
 *   type WalletAccount,
 *   type WalletProvider,
 * } from "@thruputchain/client/provider";
 * import {
 *   createProviderWalletClient,
 *   type PrepareExecutionRequest,
 * } from "@thruputchain/client/wallet";
 *
 * async function sendWithWallet(
 *   client: CoreThruputClient,
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
 * @see https://docs.thruput.network/tools/wallet-integration/
 * @see https://docs.thruput.network/tools/wallet-provider/
 */
export function createProviderWalletClient(
  options: CreateProviderWalletClientOptions,
): ProviderWalletClient {
  const { client } = options;
  const provider = parseWalletProvider(options.provider);
  const account = parseWalletAccount(options.account);
  const networkHash = parseWalletNetworkHash(options.networkHash);
  if (toBase58(client.discovery.network.networkHash) !== networkHash)
    throw new WalletProviderError(
      4901,
      "Client and provider network hashes differ",
    );
  if ("network" in client) {
    const network = client.network;
    if (
      !network ||
      typeof network !== "object" ||
      !("networkHash" in network) ||
      !isBytes(network.networkHash) ||
      toBase58(network.networkHash) !== networkHash
    ) {
      throw new WalletProviderError(
        4901,
        "Client and provider network hashes differ",
      );
    }
  }
  const preparationAccount = {
    address: contractAddress(fixedFromBase58(account.address, 32)),
    authClaim: {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: pubkeyAccountPreimage(
        {
          scheme: CryptographicScheme.Ed25519,
          ed25519: ed25519PublicKey(fixedFromBase58(account.publicKey, 32)),
        },
        BigInt(account.nonce),
      ),
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

  async function request(
    value: ProviderRequest,
    onDispatch?: () => void,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    assertActive();
    try {
      // Mark the handoff only after local guards, with no await before the provider call.
      onDispatch?.();
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

  function submitTransaction(
    input: SignTransactionResult,
    onDispatch?: () => void,
    signal?: AbortSignal,
  ): Promise<SubmitTransactionResult> {
    const checkCancellation = () => {
      if (signal?.aborted) {
        approved = undefined;
        signal.throwIfAborted();
      }
    };
    return run(async () => {
      checkCancellation();
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
      checkCancellation();
      // Consume before crossing the broadcast boundary, including ambiguous failures.
      approved = undefined;
      const value = await request(
        {
          method: "submitTransaction",
          params: {
            account: account.address,
            networkHash,
            signedTransaction: signed.signedTransaction,
          },
        },
        onDispatch,
        signal,
      );
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
      checkCancellation();
      await checkSession();
      return Object.freeze(result);
    });
  }

  const base: Omit<
    ProviderWalletClient,
    "executeAndWait" | "executeCallsAndWait" | "deployContractAndWait"
  > = {
    prepareDeployment: (deployment, options) =>
      run(async () => {
        const preparation = deploymentRequest(
          deployment,
          preparationAccount.address,
          options,
          defaultWalletAdapter,
        );
        await checkSession();
        const tx = await prepareTransaction(
          client,
          preparationAccount,
          preparation,
        );
        assertActive();
        return parseTransactionHex(toHex0x(serialize(tx, codec.Transaction)));
      }),
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
    submitTransaction: (input) => submitTransaction(input),
    dispose() {
      invalidate();
      if (!disposed) {
        disposed = true;
        unsubscribe();
      }
    },
  };

  let executing = false;
  function assertIdle() {
    if (executing)
      throw new WalletProviderError(
        -32002,
        "Another wallet execution is pending",
      );
  }
  async function execute(
    prepare: () => Promise<Transaction>,
    options: ProviderExecutionOptions,
    requireSuccess = true,
  ): Promise<ExecutionResult> {
    assertIdle();
    executing = true;
    try {
      options.wait?.signal?.throwIfAborted();
      client.requireMethods([
        "getChainTip",
        "getNetworkInfo",
        "getTransactionReceipt",
        "getTransactionStatus",
      ]);
      const signed = await base.signTransaction(await prepare());
      const evidence = createSubmissionEvidence(
        serialize(
          parseSignedTransactionHex(signed.signedTransaction),
          codec.SignedTransaction,
        ),
        hashFromBase58(networkHash),
      );
      try {
        await options.onSigned(
          Object.freeze({
            ...signed,
            account: Object.freeze({ ...account }),
            networkHash,
          }),
        );
        options.wait?.signal?.throwIfAborted();
      } catch (cause) {
        approved = undefined;
        throw new TransactionObservationError(
          evidence,
          cause,
          undefined,
          undefined,
          "beforeSubmission",
        );
      }
      let submissionDispatched = false;
      const result = await submitAndObserve(
        client,
        evidence,
        async (signal) => {
          await submitTransaction(
            signed,
            () => {
              submissionDispatched = true;
            },
            signal,
          );
        },
        {
          ...options.wait,
          expectedNetworkHash: hashFromBase58(
            networkHash,
          ) as import("@thruputchain/protocol").NetworkHash,
        },
        () => submissionDispatched,
      );
      if (requireSuccess)
        assertTransactionSuccess(result.receipt, result.submission);
      return result;
    } finally {
      executing = false;
    }
  }
  return {
    ...base,
    prepareDeployment: async (deployment, options) => {
      assertIdle();
      return base.prepareDeployment(deployment, options);
    },
    async deployContractAndWait(deployment, options, controls) {
      const address =
        deployment.address.slice() as import("@thruputchain/protocol").ContractAddress;
      const result = await execute(
        () => base.prepareDeployment(deployment, options),
        controls,
        false,
      );
      decodeDeployment(
        result.receipt,
        { ...deployment, address },
        defaultWalletAdapter,
        result.submission,
      );
      return { ...result, address };
    },
    getCapabilities: async () => {
      assertIdle();
      return base.getCapabilities();
    },
    prepareExecution: async (input) => {
      assertIdle();
      return base.prepareExecution(input);
    },
    prepareBatchExecution: async (input) => {
      assertIdle();
      return base.prepareBatchExecution(input);
    },
    signTransaction: async (input) => {
      assertIdle();
      return base.signTransaction(input);
    },
    submitTransaction: async (input) => {
      assertIdle();
      return base.submitTransaction(input);
    },
    executeAndWait: (input, controls) =>
      execute(() => base.prepareExecution(input), controls),
    async executeCallsAndWait(input, controls) {
      const calls = [...input.calls];
      const result = await execute(
        () =>
          calls.length === 1
            ? base.prepareExecution({
                ...input,
                invocation: calls[0]!.invocation,
              })
            : base.prepareBatchExecution({
                ...input,
                invocations: calls.map((call) => call.invocation),
              }),
        controls,
        false,
      );
      return {
        ...result,
        values: decodeExecution(
          result.receipt,
          calls,
          defaultWalletAdapter,
          result.submission,
        ) as CallResults<typeof input.calls>,
      };
    },
  };
}
