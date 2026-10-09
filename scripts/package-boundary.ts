import type {
  AirdropResponse,
  AirdropSucceeded,
  ChainConfig,
  ExecutionConfig,
  StorageCosts,
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
  HttpTransport,
  type HttpBatchOptions,
  createPubkeyAccount,
  createSourceAddressAccount,
  createWalletClient,
  prepareContractDeployment,
  type DeploymentOptions,
  defineCluster,
  defaultWalletAdapter,
  defineWalletInvocationAdapter,
  devnet,
  devWalletAdapter,
  localnet,
  mainnet,
  parseUnits,
  formatUnits,
  ParseUnitsError,
  contractAddress,
  blockHeight,
  sha256Hash,
  networkHash,
  gasAmount,
  contractEntrypointID,
  calldata,
  timePoint,
  invokeFlagSet,
  InvokeFlag,
  ExecResult,
  getContract,
  classifyReadError,
  type ReadErrorKind,
  type ContractAddress,
  type GasAmount,
  type NetworkHash,
  type BlockHeight,
  type SHA256Hash,
  type ContractEntrypointID,
  type Calldata,
  type TimePoint,
  type InvokeFlagSet,
  type Invocation,
  type Transaction,
  type SignedTransaction,
} from "@groundhogchain/client";
import type { Transport } from "@groundhogchain/client/transport";
import { ERC20 as BatchERC20Versions } from "@groundhogchain/client/contracts";
import {
  getContractEvents,
  getChainConfig,
  iterateEventPages,
  readViews,
} from "@groundhogchain/client/actions";

async function typedSnapshotBoundary(
  transport: Transport,
  address: ContractAddress,
) {
  const BatchERC20 = BatchERC20Versions.v0_1;
  const client = await createGroundhogClient({ transport });
  const bound = getContract({ binding: BatchERC20, address, client });
  const single = await BatchERC20.totalSupply.view({
    client,
    contract: address,
    minHeight: 42n,
  });
  const singleValue: bigint = single.value;
  void singleValue;
  const boundOutcome = await bound.totalSupply.viewOutcome({ minHeight: 42n });
  if (boundOutcome.kind === "return") {
    const value: bigint = boundOutcome.value;
    void value;
  }
  await bound.totalSupply.view({ minHeight: 42n });
  const prepared = BatchERC20.totalSupply.viewRequest({ contract: address });
  const constrainedEntry = { ...prepared, minHeight: 42n };
  // @ts-expect-error a prepared entry cannot carry a group constraint
  await client.readViews({ calls: [constrainedEntry] });
  await client.view({ ...prepared.request, minHeight: 42n });
  const singleInput = { contract: address, minHeight: 42n };
  // @ts-expect-error prepared calls cannot carry a freshness floor, including through variables
  BatchERC20.totalSupply.viewRequest(singleInput);
  // @ts-expect-error bound prepared calls cannot carry a freshness floor
  bound.totalSupply.viewRequest({ minHeight: 42n });
  const transactionInput = { ...singleInput, gasLimit: gasAmount(123n) };
  // @ts-expect-error read freshness cannot leak into transaction options
  BatchERC20.totalSupply.call(transactionInput);
  const singleRequest = { ...prepared.request, minHeight: 42n };
  // @ts-expect-error batch entries cannot carry individual minimum heights
  await client.viewBatch({ calls: [singleRequest] });
  await BatchERC20.totalSupply.view({
    client,
    contract: address,
    // @ts-expect-error heights are bigint, never JSON numbers at the public client boundary
    minHeight: 42,
  });
  const result = await readViews(transport, {
    calls: [
      BatchERC20.totalSupply.viewRequest({ contract: address }),
      BatchERC20.transfer.viewRequest({
        contract: address,
        args: { receiver: address, amount: 1n },
      }),
    ],
  });
  const [supply, transfer] = result.results;
  if (supply.kind === "return") {
    const value: bigint = supply.value;
    void value;
    // @ts-expect-error a supply result is not a string
    const wrong: string = supply.value;
    void wrong;
  }
  if (transfer.kind === "return") {
    const value: void = transfer.value;
    void value;
  }
  // @ts-expect-error getBalanceOf requires its generated argument object
  BatchERC20.getBalanceOf.viewRequest({ contract: address });
  // @ts-expect-error no arguments are accepted by totalSupply
  BatchERC20.totalSupply.viewRequest({ contract: address, args: {} });
}
void typedSnapshotBoundary;
import {
  ContractDecodeError,
  defineContractMethod,
  fixedBytes,
} from "@groundhogchain/client/contract";
import type { SignedToken } from "@groundhogchain/client/contract";
import {
  ERC20,
  ERC20Metadata,
  DefaultWallet,
  DevWallet,
  decodeERC20Event,
  default_wallet,
  groundhog_erc20_if,
} from "@groundhogchain/client/contracts";
import type { BitMap, Weight } from "@groundhogchain/protocol";
import type { Signer } from "@groundhogchain/client/signers";
import {
  SignedOp,
  defineSignedOperation,
  randomNonce,
  signedOperationPreimage,
} from "@groundhogchain/client/signed-op";
import type {
  ContractTypeSelector,
  Operation,
  SignedOperation,
  SignedOperationType,
} from "@groundhogchain/client/signed-op";
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

async function eventPagesBoundary(
  client: GroundhogClient,
  transport: Transport,
  address: ContractAddress,
  signal: AbortSignal,
) {
  const query = {
    event: groundhog_erc20_if.v0_1.events.TransferEvent,
    contractAddresses: [address],
    topics: { to: address },
    limit: 20,
  };
  const page = await client.getContractEvents(query, { signal });
  const directPage: typeof page = await getContractEvents(transport, query, {
    signal,
  });
  const amount: bigint = page.events[0]!.fields.amount;
  const receiver: ContractAddress = page.events[0]!.topics.to;
  const name: "TransferEvent" = page.events[0]!.name;
  const height: bigint = page.events[0]!.blockHeight;
  const rawQuery = {
    filters: [groundhog_erc20_if.v0_1.events.TransferEvent.filter(query)],
    cursor: page.cursor,
  };
  const pages: AsyncIterable<import("@groundhogchain/client").EventPage> =
    client.iterateEventPages(rawQuery, { signal });
  const directPages: typeof pages = iterateEventPages(transport, rawQuery, {
    signal,
  });
  await client.getContractEvents({
    ...query,
    // @ts-expect-error Topic names come from the selected descriptor.
    topics: { missing: address },
  });
  await client.getContractEvents({
    ...query,
    // @ts-expect-error Address topics cannot be bigint values.
    topics: { to: 1n },
  });
  const mint = await client.getContractEvents({
    event: groundhog_erc20_if.v0_1.events.MintEvent,
    contractAddresses: [address],
  });
  // @ts-expect-error Mint events have no from topic.
  mint.events[0]!.topics.from;
  void [directPage, amount, receiver, name, height, directPages];
}
void eventPagesBoundary;

async function chainConfigBoundary(
  client: GroundhogClient,
  transport: Transport,
) {
  const config: ChainConfig = await client.getChainConfig();
  const direct: ChainConfig = await getChainConfig(transport);
  const execution: ExecutionConfig | undefined = config.execution;
  if (execution) {
    const costs: StorageCosts = execution.storageCosts;
    const balanceDeposit: bigint = costs.balanceCost;
    const height: bigint = execution.observedTip.height;
    const limit: number | null = execution.effectiveLimits.maxRv32MemoryBytes;
    void [balanceDeposit, height, limit];
  }
  void direct;
}
void chainConfigBoundary;

const units: bigint = parseUnits("12.05", 2);
const batchOptions: HttpBatchOptions = { maxSize: 100, waitMs: 0 };
const subpathBatchOptions: import("@groundhogchain/client/transport").HttpBatchOptions =
  batchOptions;
const batchedTransport: Transport = new HttpTransport("https://rpc.example", {
  batch: subpathBatchOptions,
});
const batchedResult: Promise<string> =
  batchedTransport.request<string>("example");
void batchedResult;
const primitiveValues: [
  ContractAddress,
  BlockHeight,
  SHA256Hash,
  NetworkHash,
  GasAmount,
  ContractEntrypointID,
  Calldata,
  TimePoint,
  InvokeFlagSet,
] = [
  contractAddress(new Uint8Array(32)),
  blockHeight(1n),
  sha256Hash(new Uint8Array(32)),
  networkHash(sha256Hash(new Uint8Array(32))),
  gasAmount(1n),
  contractEntrypointID(new Uint8Array(8)),
  calldata(new Uint8Array()),
  timePoint(1n),
  invokeFlagSet(BigInt(InvokeFlag.ReadOnly)),
];
const protocolValues: [
  import("@groundhogchain/protocol").ContractAddress,
  import("@groundhogchain/protocol").BlockHeight,
  import("@groundhogchain/protocol").SHA256Hash,
  import("@groundhogchain/protocol").NetworkHash,
  import("@groundhogchain/protocol").GasAmount,
  import("@groundhogchain/protocol").ContractEntrypointID,
  import("@groundhogchain/protocol").Calldata,
  import("@groundhogchain/protocol").TimePoint,
  import("@groundhogchain/protocol").InvokeFlagSet,
] = primitiveValues;
const clientValues: typeof primitiveValues = protocolValues;
void clientValues;

function transactionTypeIdentity(
  values: [Invocation, Transaction, SignedTransaction, ExecResult],
) {
  const protocolTypes: [
    import("@groundhogchain/protocol").Invocation,
    import("@groundhogchain/protocol").Transaction,
    import("@groundhogchain/protocol").SignedTransaction,
    import("@groundhogchain/protocol").ExecResult,
  ] = values;
  const clientTypes: typeof values = protocolTypes;
  return clientTypes;
}
void transactionTypeIdentity;
const executionResult: import("@groundhogchain/protocol").ExecResult =
  ExecResult.ExecResultOK;
void executionResult;
const readErrorKind: ReadErrorKind = classifyReadError(
  new Error("unknown failure"),
);
void readErrorKind;
const formattedUnits: string = formatUnits(units, 2);
const parseErrorCode: "malformed" | "precision" = new ParseUnitsError(
  "precision",
  2,
).code;
void [formattedUnits, parseErrorCode];

async function typedExecutionBoundary(
  wallet: ProviderWalletClient,
  address: ContractAddress,
  gas: GasAmount,
  client: GroundhogClient,
) {
  const transfer = ERC20.v0_1.transfer.call({
    contract: address,
    gasLimit: gas,
    args: { receiver: address, amount: 1n },
  });
  const transferArgs: ERC20.v0_1.TransferArgs = ERC20.v0_1.transfer.decodeArgs(
    transfer.invocation.calldata,
  );
  const walletArgs: DefaultWallet.v0_1.ExecuteArgs =
    DefaultWallet.v0_1.execute.decodeArgs(
      DefaultWallet.v0_1.execute.invocation(address, gas, { calls: [] })
        .calldata,
    );
  const noArgs: void = ERC20.v0_1.getBalance.decodeArgs(new Uint8Array());
  void [transferArgs, walletArgs, noArgs];
  const token = getContract({ binding: ERC20.v0_1, address, client });
  const signal = new AbortController().signal;
  await token.getBalanceOf.view({ args: { addr: address }, signal });
  await client.getChainTip({ signal });
  const readKind: ReadErrorKind = classifyReadError(new Error(), { signal });
  void readKind;
  const boundArgs: ERC20.v0_1.TransferArgs = token.transfer.decodeArgs(
    transfer.invocation.calldata,
  );
  token.transfer.call({
    gasLimit: gas,
    // @ts-expect-error Binding an address must preserve bigint argument types.
    args: { receiver: address, amount: "1" },
  });
  // @ts-expect-error Decoded arguments must retain their original types.
  const invalidAmount: string = boundArgs.amount;
  void invalidAmount;
  const balance = ERC20.v0_1.getBalanceOf.call({
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
  ERC20.v0_1.transfer.call({ contract: address, gasLimit: gas });
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
  > = ERC20.v0_1.transfer;
  const version = await client.getVersion();
  const releaseVersion: string | null = version.releaseVersion;
  const bundleManifestDigest: string | null = version.bundleManifestDigest;
  void [releaseVersion, bundleManifestDigest];
  const transferArgs: ERC20.v0_1.TransferArgs = {
    receiver: recipient,
    amount: 1n,
  };
  const invocation: Invocation = transfer.invocation(
    contract,
    gasLimit,
    transferArgs,
  );

  const balance = await ERC20.v0_1.getBalanceOf.view({
    client,
    contract,
    args: { addr: recipient },
  });
  const outcome: ContractViewOutcome<bigint, unknown> =
    await ERC20.v0_1.getBalanceOf.viewOutcome({
      client,
      contract,
      args: { addr: recipient },
    });

  ERC20Metadata.v0_1.symbol.invocation(contract, gasLimit);
  groundhog_erc20_if.v0_1.events.AllowanceChangeEvent.filter({
    contractAddresses: [contract],
    topics: { owner: contract },
  });
  const transferTopics: groundhog_erc20_if.v0_1.events.TransferEventFilter = {
    to: { oneOf: [recipient] },
  };
  groundhog_erc20_if.v0_1.events.TransferEvent.filter({
    contractAddresses: [contract],
    topics: transferTopics,
  });
  decodeERC20Event(event);
  const mintTopics: groundhog_erc20_if.v0_1.events.MintEventFilter = {
    to: recipient,
  };
  const burnTopics: groundhog_erc20_if.v0_1.events.BurnEventFilter = {
    from: recipient,
  };
  groundhog_erc20_if.v0_1.events.MintEvent.filter({
    contractAddresses: [contract],
    topics: mintTopics,
  });
  groundhog_erc20_if.v0_1.events.BurnEvent.filter({
    contractAddresses: [contract],
    topics: burnTopics,
  });

  const executeSignedOp: ContractMethod<
    SignedOp.v0_1.ExecuteSignedOpArgs,
    SignedToken,
    unknown
  > = SignedOp.v0_1.executeSignedOp;
  const transferOperation: SignedOperationType<{ amount: bigint }> =
    defineSignedOperation<{ amount: bigint }>({
      typeDefs: [],
      typeName: "Transfer",
    });
  const transferId: ContractTypeSelector = {
    crate_name: "my_wallet",
    major: "0.1",
    module_path: "my_wallet",
    declared: "Transfer",
  };
  defineSignedOperation<{ amount: bigint }>({
    typeDefs: [],
    typeName: transferId,
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
  const deployment = prepareContractDeployment({
    deployer: pubkeyWallet.account.address,
    contract: new Uint8Array([1]),
  });
  const deploymentOptions: DeploymentOptions = {
    gasLimit: invocation.gas_limit,
    amount: 0n,
  };
  pubkeyWallet.prepareDeployment(deployment, deploymentOptions);
  // @ts-expect-error Deployment requires an explicit amount.
  pubkeyWallet.prepareDeployment(deployment, {
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

  const call: default_wallet.v0_1.$interface.WalletCall = {
    target: address,
    entrypoint: fixedBytes(invocation.entrypoint, 8),
    gas_limit: invocation.gas_limit,
    calldata: invocation.calldata,
  };
  DefaultWallet.v0_1.execute.invocation(address, invocation.gas_limit, {
    calls: [call],
  });
  DevWallet.v0_1.doAction.invocation(address, invocation.gas_limit, {
    invocationBytes: invocation.calldata,
  });
  void defaultWalletAdapter;
  void default_wallet.v0_1.$interface.WalletError.EmptyCallList;
}

void packageBoundaryTypecheck;
void clusterBoundaryTypecheck;
void walletBoundaryTypecheck;
void providerBoundaryTypecheck;
