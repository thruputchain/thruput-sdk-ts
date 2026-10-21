import type { Transport } from "./transport/types.js";
import { HttpTransport } from "./transport/http.js";
import {
  createRpcClient,
  type RpcClient,
  type RpcMethod,
} from "./rpc/client.js";
import type { Cluster, ClusterHasCapability } from "./cluster.js";
import { defineCluster } from "./cluster.js";
import type {
  AirdropAttemptRequest,
  AirdropResponse,
  AirdropSucceeded,
  EventQuery,
  EventPage,
  NetworkInfo,
  TransactionReceipt,
} from "./types/rpc.js";
import type { TransportRequestOptions } from "./transport/types.js";
import {
  requestAirdrop,
  requestAirdropAttempt,
  type RequestAirdropOptions,
} from "./actions/public/requestAirdrop.js";
import {
  waitForTransactionReceipt,
  waitForCommitment,
  type KnownCommitment,
  type WaitForTransactionReceiptOptions,
} from "./actions/public/waitForTransactionReceipt.js";
import {
  readViews,
  type ReadViewsRequest,
  type ReadViewsResponse,
} from "./actions/public/readViews.js";
import type { ContractViewRequest } from "./contract/method.js";
import {
  getContractEvents,
  type ContractEventQuery,
  type ContractEventPage,
} from "./actions/public/getContractEvents.js";
import {
  iterateTransactionsByRootAddress,
  iterateTransactionsByBlock,
  type RootAddressWalkQuery,
  type BlockTransactionWalkQuery,
} from "./actions/public/iterateTransactionPages.js";
import type { HistoryCompletion } from "./actions/public/historyWalk.js";
import type { TransactionRefPage } from "./types/rpc.js";
import {
  iterateEventPages,
  type EventWalkQuery,
} from "./actions/public/iterateEventPages.js";

/** Native RPC methods plus workflows that never sign, replace or repeat writes. */
export interface CoreThruputClient extends RpcClient {
  iterateTransactionsByRootAddress(
    query: RootAddressWalkQuery,
    options?: TransportRequestOptions,
  ): AsyncGenerator<TransactionRefPage, HistoryCompletion, unknown>;
  iterateTransactionsByBlock(
    query: BlockTransactionWalkQuery,
    options?: TransportRequestOptions,
  ): AsyncGenerator<TransactionRefPage, void, unknown>;
  waitForTransactionReceipt(
    transactionHash: Uint8Array,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<TransactionReceipt>;
  waitForCommitment(
    transactionHash: Uint8Array,
    options?: WaitForTransactionReceiptOptions,
  ): Promise<KnownCommitment>;
  readViews<const TCalls extends readonly ContractViewRequest[]>(
    request: ReadViewsRequest<TCalls>,
    options?: TransportRequestOptions,
  ): Promise<ReadViewsResponse<TCalls>>;
  getContractEvents<TName extends string, TTopics, TFields, TFilter>(
    query: ContractEventQuery<TName, TTopics, TFields, TFilter>,
    options?: TransportRequestOptions,
  ): Promise<ContractEventPage<TName, TTopics, TFields>>;
  iterateEventPages(
    query: EventWalkQuery,
    options?: TransportRequestOptions,
  ): AsyncGenerator<EventPage, HistoryCompletion, unknown>;
}

/** Optional one-call faucet workflow, gated by endpoint discovery. */
export interface AirdropActions {
  requestAirdrop(options: RequestAirdropOptions): Promise<AirdropSucceeded>;
  requestAirdropAttempt(
    request: AirdropAttemptRequest,
    options?: TransportRequestOptions,
  ): Promise<AirdropResponse>;
}
export interface ThruputClient extends CoreThruputClient, AirdropActions {}
export type ConnectedThruputClient<TCluster extends Cluster = Cluster> =
  CoreThruputClient & {
    readonly cluster: TCluster & { readonly genesisHash?: never };
    readonly network: NetworkInfo;
  } & (ClusterHasCapability<TCluster, "airdrop"> extends true
      ? AirdropActions
      : {});

export interface ThruputClientOptions {
  readonly transport: Transport;
  readonly cluster?: never;
  readonly requiredMethods?: readonly RpcMethod[];
  readonly signal?: AbortSignal;
}
export interface ClusterThruputClientOptions<
  TCluster extends Cluster = Cluster,
> {
  readonly cluster: TCluster & { readonly genesisHash?: never };
  readonly transport?: Transport;
  readonly requiredMethods?: readonly RpcMethod[];
  readonly signal?: AbortSignal;
}

/** Connect once, validate wire/network/capabilities, and bind native methods and workflows. */
export function createThruputClient<const TCluster extends Cluster>(
  options: ClusterThruputClientOptions<TCluster>,
): Promise<ConnectedThruputClient<TCluster>>;
export function createThruputClient(
  options: ThruputClientOptions,
): Promise<ThruputClient>;
export async function createThruputClient(
  options: ThruputClientOptions | ClusterThruputClientOptions,
): Promise<ThruputClient | ConnectedThruputClient> {
  const cluster =
    options.cluster === undefined ? undefined : defineCluster(options.cluster);
  const transport =
    options.transport ??
    (cluster?.rpcUrl ? new HttpTransport(cluster.rpcUrl) : undefined);
  if (!transport)
    throw new Error(
      "Cluster has no default RPC URL; provide a transport or rpcUrl",
    );
  const requiredMethods = [...(options.requiredMethods ?? [])];
  if (cluster?.capabilities.includes("airdrop"))
    requiredMethods.push("faucet_requestAirdrop");
  const rpc = await createRpcClient({
    transport,
    expectedNetworkHash: cluster?.networkHash,
    requiredMethods,
    signal: options.signal,
  });
  const client = Object.assign(rpc, {
    waitForTransactionReceipt: (
      hash: Uint8Array,
      wait?: WaitForTransactionReceiptOptions,
    ) => waitForTransactionReceipt(rpc, hash, wait),
    waitForCommitment: (
      hash: Uint8Array,
      wait?: WaitForTransactionReceiptOptions,
    ) => waitForCommitment(rpc, hash, wait),
    readViews: <const T extends readonly ContractViewRequest[]>(
      request: ReadViewsRequest<T>,
      control?: TransportRequestOptions,
    ) => readViews(rpc, request, control),
    getContractEvents: <N extends string, T, F, Q>(
      query: ContractEventQuery<N, T, F, Q>,
      control?: TransportRequestOptions,
    ) => getContractEvents(rpc, query, control),
    iterateTransactionsByRootAddress: (
      query: RootAddressWalkQuery,
      options?: TransportRequestOptions,
    ) => iterateTransactionsByRootAddress(rpc, query, options),
    iterateTransactionsByBlock: (
      query: BlockTransactionWalkQuery,
      options?: TransportRequestOptions,
    ) => iterateTransactionsByBlock(rpc, query, options),
    iterateEventPages: (
      query: EventWalkQuery,
      control?: TransportRequestOptions,
    ) => iterateEventPages(rpc, query, control),
  });
  if (!cluster || cluster.capabilities.includes("airdrop"))
    Object.assign(client, {
      requestAirdrop: (request: RequestAirdropOptions) =>
        requestAirdrop(rpc, request),
      requestAirdropAttempt: (
        request: AirdropAttemptRequest,
        control?: TransportRequestOptions,
      ) => requestAirdropAttempt(rpc, request, control),
    });
  return (
    cluster
      ? Object.assign(client, { cluster, network: rpc.discovery.network })
      : client
  ) as ThruputClient | ConnectedThruputClient;
}
