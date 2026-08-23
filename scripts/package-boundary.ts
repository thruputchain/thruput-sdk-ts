import type {
  AirdropResponse,
  AirdropSucceeded,
  ClusterHasCapability,
  Cluster,
  ConnectedGroundhogClient,
  ContractMethod,
  ContractViewOutcome,
  ExecutableWalletClient,
  GroundhogClient,
  WalletClient,
  WalletExecutionRequest,
  WalletInvocationAdapter,
} from "@groundhogchain/client";
import {
  connectGroundhogClient,
  createPubkeyAccount,
  createSourceAddressAccount,
  createWalletClient,
  customCluster,
  defaultWalletAdapter,
  defineWalletInvocationAdapter,
  devnet,
  devWalletAdapter,
  localnet,
  mainnet,
} from "@groundhogchain/client";
import type { Transport } from "@groundhogchain/client/transport";
import {
  ContractDecodeError,
  defineContractMethod,
  fixedBytes,
} from "@groundhogchain/client/contract";
import {
  ERC20,
  ERC20ApprovalEvent,
  ERC20Metadata,
  ERC20TransferEvent,
  DefaultWallet,
  DevWallet,
  WalletError,
  decodeERC20Event,
} from "@groundhogchain/client/contracts";
import type {
  ERC20TransferArgs,
  ERC20TransferEventFilter,
  WalletCall,
} from "@groundhogchain/client/contracts";
import type {
  ContractAddress,
  GasAmount,
  Invocation,
  Transaction,
  BitMap,
  Weight,
} from "@groundhogchain/protocol";
import type { Signer } from "@groundhogchain/client/signers";
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

  const attempt: Promise<AirdropResponse> = client.requestAirdropAttempt(
    {
      recipient,
      clientNonce: new Uint8Array(16),
    },
    {
      signal: new AbortController().signal,
    },
  );
  const airdrop: Promise<AirdropSucceeded> = client.requestAirdrop({
    recipient,
  });
  void attempt;
  void airdrop;

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

function clusterBoundaryTypecheck(
  transport: Transport,
  recipient: ContractAddress,
): void {
  const dev = devnet();
  const local = localnet();
  const production = mainnet();
  const custom = customCluster({
    networkId: "private-devnet",
    rpcUrl: "https://rpc.example.com",
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
  const defaultConnected: Promise<ConnectedGroundhogClient<typeof dev>> =
    connectGroundhogClient({ cluster: dev });

  connected.then((client) => client.requestAirdrop({ recipient }));
  connectGroundhogClient({ cluster: production, transport }).then((client) => {
    // @ts-expect-error Mainnet clients do not expose airdrop actions.
    client.requestAirdrop({ recipient });
  });

  void devCapability;
  void localSupportsAirdrop;
  void mainnetSupportsAirdrop;
  void widenedSupportsAirdrop;
  void mixedSupportsAirdrop;
  void customCapability;
  void connected;
  void defaultConnected;
}

function walletBoundaryTypecheck(
  client: GroundhogClient,
  address: ContractAddress,
  signer: Signer,
  allowedKeys: BitMap,
  requiredWeight: Weight,
  invocation: Invocation,
  transaction: Transaction,
): void {
  const account = createSourceAddressAccount({
    address,
    signers: [{ signer, publicKeyId: 0n }],
    allowedKeys,
    requiredWeight,
  });
  const wallet: WalletClient<GroundhogClient, typeof account> =
    createWalletClient({ client, account });

  wallet.getBalance();
  wallet.getBalance(address);
  wallet.requestAirdrop();
  wallet.prepareTransaction({
    invocation,
    nonce: 1n,
  });
  wallet.signTransaction(transaction);
  wallet.sendInvocation({ invocation });
  // @ts-expect-error Source-address clients need an explicit invocation adapter.
  wallet.execute({ invocation, gasLimit: invocation.gas_limit });

  const devWallet = createWalletClient({
    client,
    account,
    invocationAdapter: devWalletAdapter,
  });
  devWallet.execute({ invocation, gasLimit: invocation.gas_limit });

  const pubkeyAccount = createPubkeyAccount({ signer });
  const pubkeyWallet: ExecutableWalletClient<
    GroundhogClient,
    typeof pubkeyAccount
  > = createWalletClient({ client, account: pubkeyAccount });
  pubkeyWallet.prepareExecution({
    invocation,
    gasLimit: invocation.gas_limit,
  });

  interface CustomRequest extends WalletExecutionRequest {
    readonly policy: "custom";
  }
  const customAdapter: WalletInvocationAdapter<CustomRequest> =
    defineWalletInvocationAdapter({
      createRootInvocation: (_address, request: CustomRequest) =>
        request.invocation,
    });
  createWalletClient({
    client,
    account,
    invocationAdapter: customAdapter,
  }).execute({
    invocation,
    gasLimit: invocation.gas_limit,
    policy: "custom",
  });

  const call: WalletCall = {
    target: address,
    entrypoint: fixedBytes(invocation.entrypoint, 8),
    gas_limit: invocation.gas_limit,
    calldata: invocation.calldata,
  };
  DefaultWallet.execute.invocation(address, invocation.gas_limit, {
    calls: [call],
  });
  DevWallet.doAction.invocation(address, invocation.gas_limit, {
    invocationBytes: invocation.calldata,
  });
  void defaultWalletAdapter;
  void WalletError.EmptyCallList;
}

void packageBoundaryTypecheck;
void clusterBoundaryTypecheck;
void walletBoundaryTypecheck;
