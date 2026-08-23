import type { ContractAddress, Invocation } from "@groundhogchain/protocol";
import {
  connectGroundhogClient,
  customCluster,
  createWalletClient,
  type ConnectedGroundhogClient,
  type SourceAddressAccount,
} from "../../index.js";
import type { devnet, mainnet } from "../../cluster.js";
import type { Transport } from "../../transport/types.js";

function assertWalletTypes(
  devnetClient: ConnectedGroundhogClient<ReturnType<typeof devnet>>,
  mainnetClient: ConnectedGroundhogClient<ReturnType<typeof mainnet>>,
  account: SourceAddressAccount,
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
  const address: ContractAddress = devnetWallet.account.address;

  // @ts-expect-error Mainnet wallet clients do not expose airdrops.
  mainnetWallet.requestAirdrop();

  connectGroundhogClient({
    cluster: customCluster({
      networkId: "capable",
      rpcUrl: "https://rpc.example.com",
      capabilities: ["airdrop"],
    }),
    transport,
  }).then((client) => createWalletClient({ client, account }).requestAirdrop());
  connectGroundhogClient({
    cluster: customCluster({
      networkId: "incapable",
      rpcUrl: "https://rpc.example.com",
      capabilities: [],
    }),
    transport,
  }).then((client) => {
    const wallet = createWalletClient({ client, account });
    // @ts-expect-error Custom clients without the capability omit airdrops.
    wallet.requestAirdrop();
  });

  void address;
}

void assertWalletTypes;
