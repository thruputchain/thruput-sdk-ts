import type {
  ContractAddress,
  Invocation,
  Transaction,
} from "@groundhogchain/protocol";
import {
  createGroundhogClient,
  createWalletClient,
  defineWalletInvocationAdapter,
  devWalletAdapter,
  localnet,
  type ConnectedGroundhogClient,
  type PubkeyAccount,
  type SourceAddressAccount,
  type WalletExecutionRequest,
} from "../../index.js";
import type { devnet, mainnet } from "../../cluster.js";
import type { Transport } from "../../transport/types.js";

function assertWalletTypes(
  devnetClient: ConnectedGroundhogClient<ReturnType<typeof devnet>>,
  mainnetClient: ConnectedGroundhogClient<ReturnType<typeof mainnet>>,
  account: SourceAddressAccount,
  pubkeyAccount: PubkeyAccount,
  otherAddress: ContractAddress,
  invocation: Invocation,
  transport: Transport,
): void {
  const devnetWallet = createWalletClient({ client: devnetClient, account });
  const mainnetWallet = createWalletClient({ client: mainnetClient, account });

  devnetWallet.getBalance();
  devnetWallet.getBalance(otherAddress);
  devnetWallet.requestAirdrop();
  devnetWallet.requestAirdrop({ recipient: otherAddress });
  devnetWallet.prepareTransaction({ invocation });
  // @ts-expect-error Source-address wallets require an explicit adapter.
  devnetWallet.execute({ invocation, gasLimit: invocation.gas_limit });

  createWalletClient({
    client: devnetClient,
    account,
    invocationAdapter: devWalletAdapter,
  }).execute({ invocation, gasLimit: invocation.gas_limit });
  createWalletClient({ client: devnetClient, account: pubkeyAccount }).execute({
    invocation,
    gasLimit: invocation.gas_limit,
  });

  interface CustomRequest extends WalletExecutionRequest {
    readonly mode: "custom";
  }
  const customAdapter = defineWalletInvocationAdapter({
    createRootInvocation: (_address, request: CustomRequest) =>
      request.invocation,
  });
  const customWallet = createWalletClient({
    client: devnetClient,
    account,
    invocationAdapter: customAdapter,
  });
  customWallet.execute({
    invocation,
    gasLimit: invocation.gas_limit,
    mode: "custom",
  });
  // @ts-expect-error Custom adapter fields remain required.
  customWallet.execute({ invocation, gasLimit: invocation.gas_limit });
  const address: ContractAddress = devnetWallet.account.address;

  // @ts-expect-error Mainnet wallet clients do not expose airdrops.
  mainnetWallet.requestAirdrop();

  createGroundhogClient({
    cluster: localnet(),
    transport,
  }).then((client) => createWalletClient({ client, account }).requestAirdrop());
  createGroundhogClient({
    cluster: {
      networkId: "capable",
      rpcUrl: "https://rpc.example.com",
      capabilities: ["airdrop"],
    },
    transport,
  }).then((client) => createWalletClient({ client, account }).requestAirdrop());
  createGroundhogClient({
    cluster: {
      networkId: "incapable",
      rpcUrl: "https://rpc.example.com",
      capabilities: [],
    },
    transport,
  }).then((client) => {
    const wallet = createWalletClient({ client, account });
    // @ts-expect-error Custom clients without the capability omit airdrops.
    wallet.requestAirdrop();
  });

  void address;
}

function assertCollidingClientMethods(
  client: ConnectedGroundhogClient<ReturnType<typeof devnet>> & {
    execute(value: string): string;
    prepareExecution(value: string): string;
    signTransaction(value: string): string;
    sendInvocation(value: string): string;
  },
  pubkeyAccount: PubkeyAccount,
  invocation: Invocation,
  transaction: Transaction,
): void {
  const wallet = createWalletClient({ client, account: pubkeyAccount });
  wallet.execute({ invocation, gasLimit: invocation.gas_limit });
  wallet.signTransaction(transaction);
  wallet.sendInvocation({ invocation });
  // @ts-expect-error Original execute signatures are replaced by wallet actions.
  wallet.execute("invalid");
  // @ts-expect-error Original prepareExecution signatures are replaced.
  wallet.prepareExecution("invalid");
  // @ts-expect-error Original signTransaction signatures are replaced.
  wallet.signTransaction("invalid");
  // @ts-expect-error Original sendInvocation signatures are replaced.
  wallet.sendInvocation("invalid");
}

function assertSourceCollisionTypes(
  client: ConnectedGroundhogClient<ReturnType<typeof devnet>> & {
    execute(value: string): string;
  },
  account: SourceAddressAccount,
): void {
  const wallet = createWalletClient({ client, account });
  // @ts-expect-error Reserved execution methods are omitted without an adapter.
  wallet.execute("invalid");
}

void assertWalletTypes;
void assertCollidingClientMethods;
void assertSourceCollisionTypes;
