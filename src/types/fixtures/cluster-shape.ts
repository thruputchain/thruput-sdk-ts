import {
  createThruputClient,
  defineCluster,
  devnet,
  localnet,
  mainnet,
  type ClusterHasCapability,
  type Cluster,
  type ConnectedThruputClient,
  type AirdropExecutionStatus,
  type AirdropResponse,
} from "../../index.js";
import type { Transport } from "../../transport/types.js";
import type { ContractAddress } from "@thruputchain/protocol";

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
  const legacyCluster = {
    capabilities: [] as const,
    genesisHash: new Uint8Array(32),
  };
  // @ts-expect-error Genesis identity is not part of the public RPC contract.
  defineCluster(legacyCluster);

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

  const connected: Promise<ConnectedThruputClient<typeof devnetCluster>> =
    createThruputClient({ cluster: devnetCluster, transport });
  const defaultConnected: Promise<
    ConnectedThruputClient<typeof devnetCluster>
  > = createThruputClient({ cluster: devnetCluster });
  const unqualified = createThruputClient({ transport });
  // @ts-expect-error Genesis identity cannot be validated by the client.
  createThruputClient({ cluster: legacyCluster, transport });

  // @ts-expect-error Mainnet declares no optional capabilities.
  mainnetCluster.capabilities[0];
  // @ts-expect-error Unknown capabilities cannot be declared.
  createThruputClient({
    cluster: {
      name: "invalid",
      rpcUrl: "https://rpc.example.com",
      capabilities: ["staking"],
    },
  });
  // @ts-expect-error Unqualified clients have no validated cluster identity.
  unqualified.then((client) => client.cluster);

  connected.then((client) => client.requestAirdrop({ recipient }));
  createThruputClient({ cluster: localnetCluster, transport }).then((client) =>
    client.requestAirdrop({ recipient }),
  );
  createThruputClient({ cluster: privateCluster, transport }).then((client) =>
    client.requestAirdrop({ recipient }),
  );
  createThruputClient({ cluster: mainnetCluster, transport }).then((client) => {
    // @ts-expect-error Mainnet clients do not expose airdrop actions.
    client.requestAirdrop({ recipient });
  });

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
