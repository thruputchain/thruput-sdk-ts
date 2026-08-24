import {
  createGroundhogClient,
  defineCluster,
  devnet,
  localnet,
  mainnet,
  type ClusterHasCapability,
  type Cluster,
  type ConnectedGroundhogClient,
  type AirdropExecutionStatus,
  type AirdropResponse,
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
  const privateCluster = defineCluster({
    name: "private-devnet",
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
  const nestedMixedSupportsAirdrop: ClusterHasCapability<
    Cluster<readonly [] | readonly ["airdrop"]>,
    "airdrop"
  > = false;
  const customCapability: "airdrop" = privateCluster.capabilities[0];

  const connected: Promise<ConnectedGroundhogClient<typeof devnetCluster>> =
    createGroundhogClient({ cluster: devnetCluster, transport });
  const defaultConnected: Promise<
    ConnectedGroundhogClient<typeof devnetCluster>
  > = createGroundhogClient({ cluster: devnetCluster });
  const unqualified = createGroundhogClient({ transport });

  // @ts-expect-error Mainnet declares no optional capabilities.
  mainnetCluster.capabilities[0];
  // @ts-expect-error Unknown capabilities cannot be declared.
  createGroundhogClient({
    cluster: {
      name: "invalid",
      rpcUrl: "https://rpc.example.com",
      capabilities: ["staking"],
    },
  });
  // @ts-expect-error Unqualified clients have no validated cluster identity.
  unqualified.then((client) => client.cluster);

  connected.then((client) => client.requestAirdrop({ recipient }));
  createGroundhogClient({ cluster: localnetCluster, transport }).then(
    (client) => client.requestAirdrop({ recipient }),
  );
  createGroundhogClient({ cluster: privateCluster, transport }).then((client) =>
    client.requestAirdrop({ recipient }),
  );
  createGroundhogClient({ cluster: mainnetCluster, transport }).then(
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
  void nestedMixedSupportsAirdrop;
  void customCapability;
  void connected;
  void defaultConnected;
}

void assertClusterTypes;

function assertAirdropResponseNarrowing(response: AirdropResponse): bigint {
  switch (response.attemptStatus) {
    case "pending":
      return BigInt(response.retryAfterSeconds);
    case "succeeded":
      return response.height;
    default: {
      const exhaustive: never = response;
      return exhaustive;
    }
  }
}

function assertAirdropStatusExhaustive(status: AirdropExecutionStatus): string {
  switch (status.result) {
    case "ok":
    case "nonDeterministicError":
    case "failedGasSponsorship":
    case "other":
      return status.result;
    case "reverted":
      return status.message ?? status.result;
    case "deterministicError":
      return status.kind;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

void assertAirdropResponseNarrowing;
void assertAirdropStatusExhaustive;
