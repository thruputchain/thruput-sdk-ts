import type { SHA256Hash } from "@groundhogchain/protocol";
import type { NetworkInfo } from "./types/rpc.js";
import { toHex0x } from "./actions/hex.js";

/** Public Groundhog Devnet JSON-RPC endpoint. */
export const DEVNET_RPC_URL = "http://44.236.180.135:8545";

/** Default JSON-RPC endpoint for `groundhog node`. */
export const LOCALNET_RPC_URL = "http://127.0.0.1:9545";

/** Optional feature exposed by a Groundhog cluster. */
export type ClusterCapability = "airdrop";

/** Supported Groundhog cluster categories. */
export type ClusterName = "mainnet" | "devnet" | "localnet" | "custom";

/** Network identity and optional features expected at an RPC endpoint. */
export interface Cluster<
  TName extends ClusterName = ClusterName,
  TCapabilities extends readonly ClusterCapability[] =
    readonly ClusterCapability[],
> {
  /** Human-readable cluster category. */
  readonly name: TName;

  /** Exact logical network identifier returned by `groundhog_networkInfo`. */
  readonly networkId: string;

  /** Default JSON-RPC endpoint, when the cluster has one. */
  readonly rpcUrl?: string;

  /** Optional genesis hash pin for deployments that require exact identity. */
  readonly genesisHash?: SHA256Hash;

  /** Optional RPC features expected to be available on the cluster. */
  readonly capabilities: TCapabilities;
}

/** Whether a cluster declares a particular optional feature. */
export type ClusterHasCapability<
  TCluster extends Cluster,
  TCapability extends ClusterCapability,
> = false extends (
  TCluster extends Cluster<ClusterName, infer TCapabilities>
    ? number extends TCapabilities["length"]
      ? false
      : TCapability extends TCapabilities[number]
        ? true
        : false
    : false
)
  ? false
  : true;

/** Options shared by predefined cluster descriptors. */
export interface PredefinedClusterOptions {
  /** Override the cluster's default JSON-RPC endpoint. */
  readonly rpcUrl?: string;

  /** Pin the endpoint to one materialized genesis state. */
  readonly genesisHash?: SHA256Hash;
}

/** Define a cluster while preserving literal name and capability types. */
export function defineCluster<
  const TName extends ClusterName,
  const TCapabilities extends readonly ClusterCapability[],
>(cluster: Cluster<TName, TCapabilities>): Cluster<TName, TCapabilities> {
  if (cluster.networkId.trim().length === 0) {
    throw new Error("Cluster networkId must not be empty");
  }
  if (cluster.rpcUrl !== undefined) validateRpcUrl(cluster.rpcUrl);
  return cluster;
}

/** Define the canonical Groundhog mainnet cluster. */
export function mainnet(
  options: PredefinedClusterOptions = {},
): Cluster<"mainnet", readonly []> {
  return defineCluster({
    name: "mainnet",
    networkId: "mainnet",
    capabilities: [] as const,
    ...withOptionalRpcUrl(options),
    ...withGenesisHash(options),
  });
}

/** Define the resettable public Groundhog development network. */
export function devnet(
  options: PredefinedClusterOptions = {},
): Cluster<"devnet", readonly ["airdrop"]> {
  return defineCluster({
    name: "devnet",
    networkId: "devnet-preview",
    rpcUrl: options.rpcUrl ?? DEVNET_RPC_URL,
    capabilities: ["airdrop"] as const,
    ...withGenesisHash(options),
  });
}

/** Define a local `groundhog node` development network. */
export function localnet(
  options: PredefinedClusterOptions = {},
): Cluster<"localnet", readonly ["airdrop"]> {
  return defineCluster({
    name: "localnet",
    networkId: "localnet",
    rpcUrl: options.rpcUrl ?? LOCALNET_RPC_URL,
    capabilities: ["airdrop"] as const,
    ...withGenesisHash(options),
  });
}

/** Define a deployment-specific cluster and its expected optional features. */
export function customCluster<
  const TCapabilities extends readonly ClusterCapability[],
>(
  cluster: Omit<Cluster<"custom", TCapabilities>, "name">,
): Cluster<"custom", TCapabilities> {
  return defineCluster({ name: "custom", ...cluster });
}

/** Error thrown when an RPC endpoint does not match its declared cluster. */
export class NetworkMismatchError extends Error {
  readonly cluster: Cluster;
  readonly actual: NetworkInfo;

  constructor(cluster: Cluster, actual: NetworkInfo) {
    const expectedIdentity = cluster.genesisHash
      ? `${cluster.networkId} at ${toHex0x(cluster.genesisHash)}`
      : cluster.networkId;
    super(
      `Network mismatch: expected ${expectedIdentity}, received ${actual.networkId} at ${toHex0x(actual.genesisHash)}`,
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
    actual.networkId !== cluster.networkId ||
    (cluster.genesisHash !== undefined &&
      !bytesEqual(actual.genesisHash, cluster.genesisHash))
  ) {
    throw new NetworkMismatchError(cluster, actual);
  }
}

function withGenesisHash(options: PredefinedClusterOptions): {
  genesisHash?: SHA256Hash;
} {
  return options.genesisHash === undefined
    ? {}
    : { genesisHash: options.genesisHash };
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
