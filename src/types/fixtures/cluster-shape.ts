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
import type { ContractAddress } from "@groundhogchain/protocol";

function assertClusterTypes(
  transport: Transport,
  recipient: ContractAddress,
): void {
  const devnetCluster = devnet();
  const localnetCluster = localnet();
  const mainnetCluster = mainnet();
  const privateCluster = customCluster({
    networkId: "private-devnet",
    rpcUrl: "https://rpc.example.com",
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
  const defaultConnected: Promise<
    ConnectedGroundhogClient<typeof devnetCluster>
  > = connectGroundhogClient({ cluster: devnetCluster });
  const unqualified = createGroundhogClient(transport);

  // @ts-expect-error Mainnet declares no optional capabilities.
  mainnetCluster.capabilities[0];
  customCluster({
    networkId: "invalid",
    rpcUrl: "https://rpc.example.com",
    // @ts-expect-error Unknown capabilities cannot be declared.
    capabilities: ["staking"],
  });
  // @ts-expect-error Unqualified clients have no validated cluster identity.
  unqualified.cluster;

  connected.then((client) => client.requestAirdrop({ recipient }));
  connectGroundhogClient({ cluster: localnetCluster, transport }).then(
    (client) => client.requestAirdrop({ recipient }),
  );
  connectGroundhogClient({ cluster: privateCluster, transport }).then(
    (client) => client.requestAirdrop({ recipient }),
  );
  connectGroundhogClient({ cluster: mainnetCluster, transport }).then(
    (client) => {
      // @ts-expect-error Mainnet clients do not expose airdrop actions.
      client.requestAirdrop({ recipient });
    },
  );

  void devnetCapability;
  void localnetSupportsAirdrop;
  void mainnetSupportsAirdrop;
  void widenedSupportsAirdrop;
  void mixedSupportsAirdrop;
  void customCapability;
  void connected;
  void defaultConnected;
}

void assertClusterTypes;
