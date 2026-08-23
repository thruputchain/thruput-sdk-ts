import {
  connectGroundhogClient,
  createGroundhogClient,
  customCluster,
  devnet,
  localnet,
  mainnet,
  type ClusterHasCapability,
  type Cluster,
  type ConnectedGroundhogClient,
} from "../../index.js";
import type { Transport } from "../../transport/types.js";

function assertClusterTypes(transport: Transport): void {
  const devnetCluster = devnet();
  const localnetCluster = localnet();
  const mainnetCluster = mainnet();
  const privateCluster = customCluster({
    networkId: "private-devnet",
    capabilities: ["airdrop"],
  });

  const devnetCapability: "airdrop" = devnetCluster.capabilities[0];
  const localnetSupportsAirdrop: ClusterHasCapability<
    typeof localnetCluster,
    "airdrop"
  > = true;
  const mainnetSupportsAirdrop: ClusterHasCapability<
    typeof mainnetCluster,
    "airdrop"
  > = false;
  const widenedSupportsAirdrop: ClusterHasCapability<Cluster, "airdrop"> =
    false;
  const mixedSupportsAirdrop: ClusterHasCapability<
    typeof devnetCluster | typeof mainnetCluster,
    "airdrop"
  > = false;
  const customCapability: "airdrop" = privateCluster.capabilities[0];

  const connected: Promise<ConnectedGroundhogClient<typeof devnetCluster>> =
    connectGroundhogClient({ cluster: devnetCluster, transport });
  const unqualified = createGroundhogClient(transport);

  // @ts-expect-error Mainnet declares no optional capabilities.
  mainnetCluster.capabilities[0];
  // @ts-expect-error Unknown capabilities cannot be declared.
  customCluster({ networkId: "invalid", capabilities: ["staking"] });
  // @ts-expect-error Unqualified clients have no validated cluster identity.
  unqualified.cluster;

  void devnetCapability;
  void localnetSupportsAirdrop;
  void mainnetSupportsAirdrop;
  void widenedSupportsAirdrop;
  void mixedSupportsAirdrop;
  void customCapability;
  void connected;
}

void assertClusterTypes;
