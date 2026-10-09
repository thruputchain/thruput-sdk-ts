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
  AddressAuthDataResponse,
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
  ChainConfig,
  ServerLimits,
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
import { getAddressAuthData } from "./actions/public/getAddressAuthData.js";
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
import {
  getContractEvents,
  type ContractEventQuery,
  type ContractEventPage,
} from "./actions/public/getContractEvents.js";
import { iterateEventPages } from "./actions/public/iterateEventPages.js";
import { getStorageAt } from "./actions/public/getStorageAt.js";
import { getVersion } from "./actions/public/getVersion.js";
import { getServerLimits } from "./actions/public/getServerLimits.js";
import { getChainConfig } from "./actions/public/getChainConfig.js";
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
  /** Read registered signers, or null auth data for an unregistered address. */
  getAddressAuthData(
    address: ContractAddress,
    options?: TransportRequestOptions,
  ): Promise<AddressAuthDataResponse>;
  /** Return the immutable identity configured for the RPC endpoint. */
  getNetworkInfo(options?: TransportRequestOptions): Promise<NetworkInfo>;

  /** Return the latest block height and hash reported by the gateway. */
  getChainTip(options?: TransportRequestOptions): Promise<ChainTip>;

  /** Return the HOG balance for a contract address. */
  getBalance(
    address: ContractAddress,
    options?: TransportRequestOptions,
  ): Promise<BalanceResponse>;

  /** Return block metadata for a height, or `null` when the block is unknown. */
  getBlockByNumber(
    height: bigint,
    options?: TransportRequestOptions,
  ): Promise<BlockInfo | null>;

  /** Return the number of transactions currently pending in the mempool. */
  getPendingTransactionCount(
    options?: TransportRequestOptions,
  ): Promise<bigint>;

  /** Return the gateway implementation and wire-format version. */
  getVersion(options?: TransportRequestOptions): Promise<VersionInfo>;

  /**
   * Return stated execution limits and, when supported, a fresh `execution`
   * reading with effective limits, bigint storage prices, and snapshot context.
   * Unstated top-level limits are `null`; unavailable execution readings are absent.
   */
  getChainConfig(options?: TransportRequestOptions): Promise<ChainConfig>;

  /** Return request bounds configured on this endpoint. */
  getServerLimits(options?: TransportRequestOptions): Promise<ServerLimits>;

  /** Execute a read-only contract invocation without submitting a transaction. */
  view(
    request: ViewRequest,
    options?: TransportRequestOptions,
  ): Promise<ViewResponse>;

  /** Return a committed transaction receipt, or `null` when it is not found. */
  getTransactionReceipt(
    txHash: SHA256Hash,
    options?: TransportRequestOptions,
  ): Promise<TransactionReceipt | null>;

  /** Return the gateway's current knowledge of a submitted transaction. */
  getTransactionStatus(
    txHash: SHA256Hash,
    options?: TransportRequestOptions,
  ): Promise<TransactionStatus>;

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
    options?: TransportRequestOptions,
  ): Promise<TransactionRefPage>;

  /** Query emitted contract events with the gateway's paginated event API. */
  getEvents(
    query: EventQuery,
    options?: TransportRequestOptions,
  ): Promise<EventPage>;

  /** Fetch one page of decoded events using a generated descriptor. */
  getContractEvents<TName extends string, TTopics, TFields, TFilter>(
    query: ContractEventQuery<TName, TTopics, TFields, TFilter>,
    options?: TransportRequestOptions,
  ): Promise<ContractEventPage<TName, TTopics, TFields>>;

  /** Walk event pages lazily; stops at an empty cursor without polling or retrying. */
  iterateEventPages(
    query: EventQuery,
    options?: TransportRequestOptions,
  ): AsyncGenerator<EventPage, void, unknown>;

  /** Read a committed storage item at a contract address and storage key. */
  getStorageAt(
    address: ContractAddress,
    key: Uint8Array,
    options?: TransportRequestOptions,
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

function createCoreGroundhogClient(transport: Transport): CoreGroundhogClient {
  return {
    getNetworkInfo: (options) => getNetworkInfo(transport, options),
    getChainTip: (options) => getChainTip(transport, options),
    getBalance: (address, options) => getBalance(transport, address, options),
    getAddressAuthData: (address, options) =>
      getAddressAuthData(transport, address, options),
    getBlockByNumber: (height, options) =>
      getBlockByNumber(transport, height, options),
    getPendingTransactionCount: (options) =>
      getPendingTransactionCount(transport, options),
    getVersion: (options) => getVersion(transport, options),
    getServerLimits: (options) => getServerLimits(transport, options),
    getChainConfig: (options) => getChainConfig(transport, options),
    view: (request, options) => view(transport, request, options),
    getTransactionReceipt: (txHash, options) =>
      getTransactionReceipt(transport, txHash, options),
    getTransactionStatus: (txHash, options) =>
      getTransactionStatus(transport, txHash, options),
    waitForTransactionReceipt: (txHash, options) =>
      waitForTransactionReceipt(transport, txHash, options),
    getTransactionsByAddress: (query, options) =>
      getTransactionsByAddress(transport, query, options),
    getEvents: (query, options) => getEvents(transport, query, options),
    getContractEvents: (query, options) =>
      getContractEvents(transport, query, options),
    iterateEventPages: (query, options) =>
      iterateEventPages(transport, query, options),
    getStorageAt: (address, key, options) =>
      getStorageAt(transport, address, key, options),
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

/** A client with a fetched network identity, verified against any cluster identity pin. */
export type ConnectedGroundhogClient<TCluster extends Cluster = Cluster> =
  CoreGroundhogClient &
    (ClusterHasCapability<TCluster, "airdrop"> extends true
      ? AirdropActions
      : object) & {
      /** Cluster descriptor used to connect this client. */
      readonly cluster: TCluster;

      /** Identity returned by the endpoint during connection. */
      readonly network: NetworkInfo;
    };

/** Options for an unqualified client that skips runtime identity validation. */
export interface GroundhogClientOptions {
  readonly transport: Transport;
  readonly cluster?: never;
}

/** Options for fetching network identity and verifying any declared cluster identity pin. */
export interface ClusterGroundhogClientOptions<
  TCluster extends Cluster = Cluster,
> {
  readonly cluster: TCluster & { readonly genesisHash?: never };
  /** Custom transport. Defaults to an HTTP transport for `cluster.rpcUrl`. */
  readonly transport?: Transport;
}

/**
 * Create a client and, when a cluster is supplied, fetch the endpoint's network
 * identity and verify any supplied `networkHash` pin. Identity is checked only
 * during connection; cluster capabilities are declared, not probed.
 */
export function createGroundhogClient<const TCluster extends Cluster>(
  options: ClusterGroundhogClientOptions<TCluster>,
): Promise<ConnectedGroundhogClient<TCluster>>;
export function createGroundhogClient(
  options: GroundhogClientOptions,
): Promise<GroundhogClient>;
export async function createGroundhogClient(
  options: GroundhogClientOptions | ClusterGroundhogClientOptions<Cluster>,
): Promise<GroundhogClient | ConnectedGroundhogClient> {
  if (options.cluster === undefined) {
    return Object.assign(
      createCoreGroundhogClient(options.transport),
      createAirdropActions(options.transport),
    );
  }

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
  ) as ConnectedGroundhogClient;
}

function resolveClusterTransport<TCluster extends Cluster>(
  options: ClusterGroundhogClientOptions<TCluster>,
): Transport {
  if (options.transport) return options.transport;
  if (options.cluster.rpcUrl) return new HttpTransport(options.cluster.rpcUrl);
  throw new Error(
    `Cluster ${options.cluster.name ?? "descriptor"} has no default RPC URL; provide a transport or rpcUrl`,
  );
}
