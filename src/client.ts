import type { Transport, TransportRequestOptions } from "./transport/types.js";
import { HttpTransport } from "./transport/http.js";
import type {
  ContractAddress,
  SHA256Hash,
  SignedTransaction,
} from "@groundhogchain/protocol";
import type {
  ChainTip,
  BalanceResponse,
  BlockInfo,
  VersionInfo,
  ViewRequest,
  ViewResponse,
  TransactionReceipt,
  TransactionStatus,
  AddressTransactionQuery,
  TransactionRefPage,
  EventQuery,
  EventPage,
  StorageItemRead,
  NetworkInfo,
} from "./types/rpc.js";
import type { Cluster, ClusterHasCapability } from "./cluster.js";
import { assertNetworkMatchesCluster, defineCluster } from "./cluster.js";
import { getChainTip } from "./actions/public/getChainTip.js";
import { getNetworkInfo } from "./actions/public/getNetworkInfo.js";
import {
  requestAirdrop,
  requestAirdropAttempt,
  type RequestAirdropOptions,
} from "./actions/public/requestAirdrop.js";
import type {
  AirdropAttemptRequest,
  AirdropResponse,
  AirdropSucceeded,
} from "./types/rpc.js";
import { getBalance } from "./actions/public/getBalance.js";
import { getBlockByNumber } from "./actions/public/getBlockByNumber.js";
import { getPendingTransactionCount } from "./actions/public/getPendingTransactionCount.js";
import { getTransactionReceipt } from "./actions/public/getTransactionReceipt.js";
import { getTransactionStatus } from "./actions/public/getTransactionStatus.js";
import {
  waitForTransactionReceipt,
  type WaitForTransactionReceiptOptions,
} from "./actions/public/waitForTransactionReceipt.js";
import { getTransactionsByAddress } from "./actions/public/getTransactionsByAddress.js";
import { getEvents } from "./actions/public/getEvents.js";
import { getStorageAt } from "./actions/public/getStorageAt.js";
import { getVersion } from "./actions/public/getVersion.js";
import { view } from "./actions/public/view.js";
import { sendTransaction } from "./actions/wallet/sendTransaction.js";

/**
 * Convenience client with all supported Groundhog actions bound to a single
 * transport.
 *
 * Use {@link createGroundhogClient} when application code should not pass a
 * transport into every action call.
 */
export interface CoreGroundhogClient {
  /** Return the immutable identity configured for the RPC endpoint. */
  getNetworkInfo(): Promise<NetworkInfo>;

  /** Return the latest block height and hash reported by the gateway. */
  getChainTip(): Promise<ChainTip>;

  /** Return the HOG balance for a contract address. */
  getBalance(address: ContractAddress): Promise<BalanceResponse>;

  /** Return block metadata for a height, or `null` when the block is unknown. */
  getBlockByNumber(height: bigint): Promise<BlockInfo | null>;

  /** Return the number of transactions currently pending in the mempool. */
  getPendingTransactionCount(): Promise<bigint>;

  /** Return the gateway implementation and wire-format version. */
  getVersion(): Promise<VersionInfo>;

  /** Execute a read-only contract invocation without submitting a transaction. */
  view(request: ViewRequest): Promise<ViewResponse>;

  /** Return a committed transaction receipt, or `null` when it is not found. */
  getTransactionReceipt(txHash: SHA256Hash): Promise<TransactionReceipt | null>;

  /** Return the gateway's current knowledge of a submitted transaction. */
  getTransactionStatus(txHash: SHA256Hash): Promise<TransactionStatus>;

  /**
   * Wait for a transaction to commit and return its receipt.
   *
   * Inspect `receipt.execResult` to determine whether execution succeeded.
   */
  waitForTransactionReceipt(
    txHash: SHA256Hash,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<TransactionReceipt>;

  /** Query transaction refs whose root invocation targets one address. */
  getTransactionsByAddress(
    query: AddressTransactionQuery,
  ): Promise<TransactionRefPage>;

  /** Query emitted contract events with the gateway's paginated event API. */
  getEvents(query: EventQuery): Promise<EventPage>;

  /** Read a committed storage item at a contract address and storage key. */
  getStorageAt(
    address: ContractAddress,
    key: Uint8Array,
  ): Promise<StorageItemRead>;

  /** Submit a signed transaction and return its transaction hash. */
  sendTransaction(signedTx: SignedTransaction): Promise<SHA256Hash>;
}

/** Airdrop actions available on development clusters and unqualified clients. */
export interface AirdropActions {
  /** Perform one airdrop attempt request without polling. */
  requestAirdropAttempt(
    request: AirdropAttemptRequest,
    options?: TransportRequestOptions,
  ): Promise<AirdropResponse>;

  /** Request an airdrop and wait for it to commit. */
  requestAirdrop(options: RequestAirdropOptions): Promise<AirdropSucceeded>;
}

/** Unqualified client with every supported SDK action. */
export interface GroundhogClient extends CoreGroundhogClient, AirdropActions {}

/**
 * Create a convenience client by binding all SDK actions to a transport.
 *
 * The returned object is intentionally thin: each method delegates to the
 * corresponding standalone action with the provided transport.
 *
 * @example
 * ```ts
 * import { createGroundhogClient, HttpTransport } from "@groundhogchain/client";
 *
 * const client = createGroundhogClient(
 *   new HttpTransport("http://127.0.0.1:9545"),
 * );
 *
 * const tip = await client.getChainTip();
 * ```
 */
export function createGroundhogClient(transport: Transport): GroundhogClient {
  return Object.assign(
    createCoreGroundhogClient(transport),
    createAirdropActions(transport),
  );
}

function createCoreGroundhogClient(transport: Transport): CoreGroundhogClient {
  return {
    getNetworkInfo: () => getNetworkInfo(transport),
    getChainTip: () => getChainTip(transport),
    getBalance: (address) => getBalance(transport, address),
    getBlockByNumber: (height) => getBlockByNumber(transport, height),
    getPendingTransactionCount: () => getPendingTransactionCount(transport),
    getVersion: () => getVersion(transport),
    view: (request) => view(transport, request),
    getTransactionReceipt: (txHash) => getTransactionReceipt(transport, txHash),
    getTransactionStatus: (txHash) => getTransactionStatus(transport, txHash),
    waitForTransactionReceipt: (txHash, options) =>
      waitForTransactionReceipt(transport, txHash, options),
    getTransactionsByAddress: (query) =>
      getTransactionsByAddress(transport, query),
    getEvents: (query) => getEvents(transport, query),
    getStorageAt: (address, key) => getStorageAt(transport, address, key),
    sendTransaction: (signedTx) => sendTransaction(transport, signedTx),
  };
}

function createAirdropActions(transport: Transport): AirdropActions {
  return {
    requestAirdropAttempt: (request, options) =>
      requestAirdropAttempt(transport, request, options),
    requestAirdrop: (options) => requestAirdrop(transport, options),
  };
}

/** A client whose RPC endpoint has been validated against a cluster. */
export type ConnectedGroundhogClient<TCluster extends Cluster = Cluster> =
  CoreGroundhogClient &
    (ClusterHasCapability<TCluster, "airdrop"> extends true
      ? AirdropActions
      : object) & {
      /** Cluster descriptor used to validate this client. */
      readonly cluster: TCluster;

      /** Identity returned by the endpoint during connection. */
      readonly network: NetworkInfo;
    };

/** Options for connecting and validating a cluster-aware client. */
export interface ConnectGroundhogClientOptions<
  TCluster extends Cluster = Cluster,
> {
  readonly cluster: TCluster;
  /** Custom transport. Defaults to an HTTP transport for `cluster.rpcUrl`. */
  readonly transport?: Transport;
}

/**
 * Create a client after validating the endpoint's runtime network identity.
 *
 * Use {@link createGroundhogClient} instead for an unqualified endpoint when
 * runtime identity validation is not required.
 */
export async function connectGroundhogClient<TCluster extends Cluster>(
  options: ConnectGroundhogClientOptions<TCluster>,
): Promise<ConnectedGroundhogClient<TCluster>> {
  const cluster = defineCluster(options.cluster);
  const transport = resolveClusterTransport({ ...options, cluster });
  const client = createCoreGroundhogClient(transport);
  const network = await client.getNetworkInfo();
  assertNetworkMatchesCluster(cluster, network);
  return Object.assign(
    client,
    cluster.capabilities.includes("airdrop")
      ? createAirdropActions(transport)
      : {},
    { cluster, network },
  ) as ConnectedGroundhogClient<TCluster>;
}

function resolveClusterTransport<TCluster extends Cluster>(
  options: ConnectGroundhogClientOptions<TCluster>,
): Transport {
  if (options.transport) return options.transport;
  if (options.cluster.rpcUrl) return new HttpTransport(options.cluster.rpcUrl);
  throw new Error(
    `Cluster ${options.cluster.name} has no default RPC URL; provide a transport or rpcUrl`,
  );
}
