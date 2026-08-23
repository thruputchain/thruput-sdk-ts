import type {
  ClusterHasCapability,
  Cluster,
  ConnectedGroundhogClient,
  ContractMethod,
  ContractViewOutcome,
  GroundhogClient,
} from "@groundhogchain/client";
import {
  connectGroundhogClient,
  customCluster,
  devnet,
  localnet,
  mainnet,
} from "@groundhogchain/client";
import type { Transport } from "@groundhogchain/client/transport";
import {
  ContractDecodeError,
  defineContractMethod,
} from "@groundhogchain/client/contract";
import {
  ERC20,
  ERC20ApprovalEvent,
  ERC20Metadata,
  ERC20TransferEvent,
  decodeERC20Event,
} from "@groundhogchain/client/contracts";
import type {
  ERC20TransferArgs,
  ERC20TransferEventFilter,
} from "@groundhogchain/client/contracts";
import type {
  ContractAddress,
  GasAmount,
  Invocation,
} from "@groundhogchain/protocol";
import {
  loadLocalDevAccount,
  type LoadLocalDevAccountOptions,
  type LocalDevAccount,
  type LocalDevAccountRole,
} from "@groundhogchain/client/local-dev";

async function packageBoundaryTypecheck(
  client: GroundhogClient,
  contract: ContractAddress,
  recipient: ContractAddress,
  gasLimit: GasAmount,
  event: { topics: Uint8Array[]; data: Uint8Array },
): Promise<void> {
  const transfer: ContractMethod<
    { receiver: ContractAddress; amount: bigint },
    void,
    unknown
  > = ERC20.transfer;
  const transferArgs: ERC20TransferArgs = {
    receiver: recipient,
    amount: 1n,
  };
  const invocation: Invocation = transfer.invocation(
    contract,
    gasLimit,
    transferArgs,
  );

  const balance = await ERC20.getBalanceOf.view({
    client,
    contract,
    args: { addr: recipient },
  });
  const outcome: ContractViewOutcome<bigint, unknown> =
    await ERC20.getBalanceOf.viewOutcome({
      client,
      contract,
      args: { addr: recipient },
    });

  ERC20Metadata.symbol.invocation(contract, gasLimit);
  ERC20ApprovalEvent.filter({
    contractAddresses: [contract],
    topics: { owner: contract },
  });
  const transferTopics: ERC20TransferEventFilter = {
    to: { oneOf: [recipient] },
  };
  ERC20TransferEvent.filter({
    contractAddresses: [contract],
    topics: transferTopics,
  });
  decodeERC20Event(event);

  void invocation;
  void balance.value;
  void outcome.kind;
  void ContractDecodeError;
  void defineContractMethod;

  const localDevRole: LocalDevAccountRole = "faucet";
  const localDevOptions: LoadLocalDevAccountOptions = {
    role: localDevRole,
    roleOffset: 0,
    env: { GROUNDHOG_RUNTIME_MANIFEST: "/tmp/runtime-manifest.json" },
  };
  const localDevAccount: Promise<LocalDevAccount> =
    loadLocalDevAccount(localDevOptions);
  void localDevAccount;
}

function clusterBoundaryTypecheck(transport: Transport): void {
  const dev = devnet();
  const local = localnet();
  const production = mainnet();
  const custom = customCluster({
    networkId: "private-devnet",
    capabilities: ["airdrop"],
  });

  const devCapability: "airdrop" = dev.capabilities[0];
  const localSupportsAirdrop: ClusterHasCapability<typeof local, "airdrop"> =
    true;
  const mainnetSupportsAirdrop: ClusterHasCapability<
    typeof production,
    "airdrop"
  > = false;
  const widenedSupportsAirdrop: ClusterHasCapability<Cluster, "airdrop"> =
    false;
  const mixedSupportsAirdrop: ClusterHasCapability<
    typeof dev | typeof production,
    "airdrop"
  > = false;
  const customCapability: "airdrop" = custom.capabilities[0];
  const connected: Promise<ConnectedGroundhogClient<typeof dev>> =
    connectGroundhogClient({ cluster: dev, transport });

  void devCapability;
  void localSupportsAirdrop;
  void mainnetSupportsAirdrop;
  void widenedSupportsAirdrop;
  void mixedSupportsAirdrop;
  void customCapability;
  void connected;
}

void packageBoundaryTypecheck;
void clusterBoundaryTypecheck;
