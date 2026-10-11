import {
  networkHash as toNetworkHash,
  sha256Hash,
  type NetworkHash,
} from "@groundhogchain/protocol";
import type { NetworkInfo } from "./types/rpc.js";
import { toHex0x } from "./actions/hex.js";

/** Public Groundhog Devnet JSON-RPC endpoint. */
export const DEVNET_RPC_URL = "https://rpc.thruput.network";

/** Default JSON-RPC endpoint for `thruput node`. */
export const LOCALNET_RPC_URL = "http://127.0.0.1:9545";

/** Optional feature exposed by a Groundhog cluster. */
export type ClusterCapability = "airdrop";

/** Network identity and optional features expected at an RPC endpoint. */
export interface Cluster<
  TCapabilities extends readonly ClusterCapability[] =
    readonly ClusterCapability[],
> {
  /** Optional human-readable cluster name. */
  readonly name?: string;

  /** Optional protocol network identity pin. */
  readonly networkHash?: NetworkHash;

  /** Default JSON-RPC endpoint, when the cluster has one. */
  readonly rpcUrl?: string;

  /** Optional RPC features expected to be available on the cluster. */
  readonly capabilities: TCapabilities;
}

/** Whether every possible cluster descriptor declares an optional feature. */
export type ClusterHasCapability<
  TCluster extends Cluster,
  TCapability extends ClusterCapability,
> = false extends (
  TCluster extends Cluster<infer TCapabilities>
    ? TCapabilities extends readonly ClusterCapability[]
      ? number extends TCapabilities["length"]
        ? false
        : TCapability extends TCapabilities[number]
          ? true
          : false
      : false
    : false
)
  ? false
  : true;

/** Options shared by predefined cluster descriptors. */
export interface PredefinedClusterOptions {
  /** Override the cluster's default JSON-RPC endpoint. */
  readonly rpcUrl?: string;

  /** Pin the endpoint to one protocol signing network. */
  readonly networkHash?: NetworkHash;
}

/** Define a reusable cluster while preserving its literal capability types. */
export function defineCluster<const TCluster extends Cluster>(
  cluster: TCluster & { readonly genesisHash?: never },
): TCluster {
  if (cluster.rpcUrl !== undefined) validateRpcUrl(cluster.rpcUrl);
  return Object.freeze({
    ...cluster,
    ...(cluster.networkHash === undefined
      ? {}
      : {
          networkHash: toNetworkHash(
            sha256Hash(new Uint8Array(cluster.networkHash)),
          ),
        }),
    capabilities: Object.freeze([
      ...cluster.capabilities,
    ]) as unknown as TCluster["capabilities"],
  }) as TCluster;
}

/** Define the canonical Groundhog mainnet cluster. */
export function mainnet(
  options: PredefinedClusterOptions = {},
): Cluster<readonly []> & { readonly name: "mainnet" } {
  return defineCluster({
    name: "mainnet",
    capabilities: [] as const,
    ...withOptionalRpcUrl(options),
    ...withNetworkHash(options),
  });
}

/** Define the resettable public Groundhog development network, unpinned unless `networkHash` is supplied. */
export function devnet(
  options: PredefinedClusterOptions = {},
): Cluster<readonly ["airdrop"]> & { readonly name: "devnet" } {
  return defineCluster({
    name: "devnet",
    rpcUrl: options.rpcUrl ?? DEVNET_RPC_URL,
    capabilities: ["airdrop"] as const,
    ...withNetworkHash(options),
  });
}

/** Define a local `thruput node` development network. */
export function localnet(
  options: PredefinedClusterOptions = {},
): Cluster<readonly ["airdrop"]> & { readonly name: "localnet" } {
  return defineCluster({
    name: "localnet",
    networkHash:
      options.networkHash ?? toNetworkHash(sha256Hash(new Uint8Array(32))),
    rpcUrl: options.rpcUrl ?? LOCALNET_RPC_URL,
    capabilities: ["airdrop"] as const,
  });
}

/** Error thrown when an RPC endpoint does not match its declared cluster. */
export class NetworkMismatchError extends Error {
  readonly cluster: Cluster;
  readonly actual: NetworkInfo;

  constructor(cluster: Cluster, actual: NetworkInfo) {
    const expected =
      cluster.networkHash === undefined
        ? "an unpinned network"
        : `network ${toHex0x(cluster.networkHash)}`;
    super(
      `Network mismatch${cluster.name ? ` for ${cluster.name}` : ""}: expected ${expected}, received network ${toHex0x(actual.networkHash)}`,
    );
    this.name = "NetworkMismatchError";
    this.cluster = cluster;
    this.actual = actual;
  }
}

/** Assert that runtime network information matches a cluster descriptor. */
export function assertNetworkMatchesCluster(
  cluster: Cluster,
  actual: NetworkInfo,
): void {
  if (
    cluster.networkHash !== undefined &&
    !bytesEqual(actual.networkHash, cluster.networkHash)
  ) {
    throw new NetworkMismatchError(cluster, actual);
  }
}

function withNetworkHash(options: PredefinedClusterOptions): {
  networkHash?: NetworkHash;
} {
  return options.networkHash === undefined
    ? {}
    : { networkHash: options.networkHash };
}

function withOptionalRpcUrl(options: PredefinedClusterOptions): {
  rpcUrl?: string;
} {
  return options.rpcUrl === undefined ? {} : { rpcUrl: options.rpcUrl };
}

function validateRpcUrl(rpcUrl: string): void {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error(`Cluster rpcUrl must be an absolute HTTP URL: ${rpcUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Cluster rpcUrl must use HTTP or HTTPS: ${rpcUrl}`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
