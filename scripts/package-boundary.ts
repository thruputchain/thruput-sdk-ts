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
  createGroundhogClient,
  createPubkeyAccount,
  createSourceAddressAccount,
  createWalletClient,
  defineCluster,
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
import type { SignedToken } from "@groundhogchain/client/contract";
import {
  ERC20,
  ERC20ApprovalEvent,
  ERC20BurnEvent,
  ERC20MintEvent,
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
  ERC20BurnEventFilter,
  ERC20MintEventFilter,
  WalletCall,
} from "@groundhogchain/client/contracts";
import type {
  ContractAddress,
  GasAmount,
  Invocation,
  Transaction,
  BitMap,
  Weight,
  NetworkHash,
} from "@groundhogchain/protocol";
import type { Signer } from "@groundhogchain/client/signers";
import {
  SignedOp,
  defineSignedOperation,
  randomNonce,
  signedOperationPreimage,
} from "@groundhogchain/client/signed-op";
import type {
  Operation,
  SignedOpExecuteSignedOpArgs,
  SignedOperation,
  SignedOperationType,
} from "@groundhogchain/client/signed-op";
import {
  loadLocalDevAccount,
  type LoadLocalDevAccountOptions,
  type LocalDevAccount,
  type LocalDevAccountRole,
} from "@groundhogchain/client/local-dev";
import {
  discoverWalletProviders,
  registerWalletProvider,
  parseWalletSession,
  type WalletAccount as ProviderAccount,
  type WalletProvider,
  type SignTransactionResult,
  type SubmitTransactionResult,
} from "@groundhogchain/client/provider";
import {
  createProviderWalletClient,
  type ProviderWalletClient,
  type WalletAccount as LocalWalletAccount,
} from "@groundhogchain/client/wallet";

async function typedExecutionBoundary(
  wallet: ProviderWalletClient,
  address: ContractAddress,
  gas: GasAmount,
) {
  const transfer = ERC20.transfer.call({
    contract: address,
    gasLimit: gas,
    args: { receiver: address, amount: 1n },
  });
  const balance = ERC20.getBalanceOf.call({
    contract: address,
    gasLimit: gas,
    args: { addr: address },
  });
  const result = await wallet.executeCallsAndWait(
    { calls: [transfer, balance] as const, gasLimit: gas },
    {
      onSigned: async (pending) => {
        const hash: string = pending.hash;
        void hash;
      },
    },
  );
  const values: readonly [void, bigint] = result.values;
  // @ts-expect-error The second call returns a bigint, not a string.
  const wrong: string = result.values[1];
  // @ts-expect-error Typed calls require the generated arguments.
  ERC20.transfer.call({ contract: address, gasLimit: gas });
  void values;
  void wrong;
}
void typedExecutionBoundary;

async function providerBoundaryTypecheck(
  client: GroundhogClient,
  provider: WalletProvider,
  invocation: Invocation,
  persist: (signed: SignTransactionResult) => Promise<void>,
): Promise<void> {
  const stop = discoverWalletProviders((discovered) => {
    const version: "1.0.0" = discovered.info.version;
    void version;
  }, new EventTarget());
  const unregister = registerWalletProvider(provider, new EventTarget());
  const session = parseWalletSession(
    await provider.request({ method: "connect" }),
  );
  const account: ProviderAccount | undefined = session.accounts[0];
  if (!account) return;
  const wallet: ProviderWalletClient = createProviderWalletClient({
    client,
    provider,
    account,
    networkHash: session.networkHash,
  });
  const tx: Transaction = await wallet.prepareExecution({
    invocation,
    gasLimit: invocation.gas_limit,
  });
  const signed: SignTransactionResult = await wallet.signTransaction(tx);
  await persist(signed);
  const result: SubmitTransactionResult =
    await wallet.submitTransaction(signed);
  const hash: string = result.hash;
  // @ts-expect-error Provider accounts are not raw-signer accounts.
  const local: LocalWalletAccount = account;
  // @ts-expect-error The provider does not expose arbitrary-byte signing.
  provider.request({ method: "signMessage", params: { message: "0x00" } });
  // @ts-expect-error The adapter deliberately has no implicit sign-and-submit action.
  wallet.execute({ invocation, gasLimit: invocation.gas_limit });
  wallet.dispose();
  stop();
  unregister();
  void hash;
  void local;
}

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
  const mintTopics: ERC20MintEventFilter = { to: recipient };
  const burnTopics: ERC20BurnEventFilter = { from: recipient };
  ERC20MintEvent.filter({ contractAddresses: [contract], topics: mintTopics });
  ERC20BurnEvent.filter({ contractAddresses: [contract], topics: burnTopics });

  const executeSignedOp: ContractMethod<
    SignedOpExecuteSignedOpArgs,
    SignedToken,
    unknown
  > = SignedOp.executeSignedOp;
  const transferOperation: SignedOperationType<{ amount: bigint }> =
    defineSignedOperation<{ amount: bigint }>({
      typeDefs: [],
      typeName: "Transfer",
    });
  const signedOperation: Promise<SignedOperation> = transferOperation.sign(
    {} as Signer,
    {
      network: {} as NetworkHash,
      verifyingContract: contract,
      blockExpiryHeight: 0n,
      nonce: randomNonce(),
      body: { amount: 1n },
    },
  );
  const operation: Operation = (await signedOperation).op;
  void executeSignedOp;
  void operation;
  void signedOperationPreimage;

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
  const custom = defineCluster({
    name: "private-devnet",
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
    createGroundhogClient({ cluster: dev, transport });
  const defaultConnected: Promise<ConnectedGroundhogClient<typeof dev>> =
    createGroundhogClient({ cluster: dev });

  connected.then((client) => client.requestAirdrop({ recipient }));
  createGroundhogClient({ cluster: production, transport }).then((client) => {
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
  networkHash: NetworkHash,
): void {
  const account = createSourceAddressAccount({
    address,
    signers: [{ signer, publicKeyId: 0n }],
    allowedKeys,
    requiredWeight,
  });
  const wallet: WalletClient<GroundhogClient, typeof account> =
    createWalletClient({ client, account, networkHash });

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
    networkHash,
    invocationAdapter: devWalletAdapter,
  });
  devWallet.execute({ invocation, gasLimit: invocation.gas_limit });

  const pubkeyAccount = createPubkeyAccount({ signer });
  const pubkeyWallet: ExecutableWalletClient<
    GroundhogClient,
    typeof pubkeyAccount
  > = createWalletClient({ client, account: pubkeyAccount, networkHash });
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
    networkHash,
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
void providerBoundaryTypecheck;
