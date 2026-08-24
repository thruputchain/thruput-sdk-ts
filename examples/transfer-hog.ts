import { randomBytes } from "node:crypto";
import { HOG_ADDRESS, gasAmount } from "@groundhogchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  PrivateKeySigner,
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  devnet,
  toHex0x,
} from "../src/index.js";
import { DefaultWallet, ERC20 } from "../src/contracts/index.js";

const amount = 1_000n;
const walletGasLimit = gasAmount(10_000_000n);
const callGasLimit = gasAmount(500_000n);
const rpcUrl = process.env.GROUNDHOG_RPC_URL;

// These accounts exist only for this process. Their keys are not persisted.
const sender = createPubkeyAccount({
  signer: new PrivateKeySigner(randomBytes(32)),
});
const recipient = createPubkeyAccount({
  signer: new PrivateKeySigner(randomBytes(32)),
});

const client = await createGroundhogClient({
  cluster: devnet(rpcUrl ? { rpcUrl } : {}),
});
const wallet = createWalletClient({
  client,
  account: sender,
  networkHash: client.network.networkHash,
});

const airdrop = await wallet.requestAirdrop();
if (airdrop.status.result !== "ok") {
  throw new Error(`Airdrop transaction failed with ${airdrop.status.result}`);
}
if (airdrop.rawAmount < amount) {
  throw new Error(
    `Airdrop supplied ${airdrop.rawAmount} base units, fewer than the ${amount} requested for transfer`,
  );
}

const transfer = ERC20.transfer.invocation(HOG_ADDRESS, callGasLimit, {
  receiver: recipient.address,
  amount,
});
const txHash = await wallet.execute({
  invocation: transfer,
  gasLimit: walletGasLimit,
});
const receipt = DefaultWallet.execute.decodeReceipt(
  await wallet.waitForTransactionReceipt(txHash),
);
if (receipt.value.length !== 1 || receipt.value[0]!.length !== 0) {
  throw new Error("DefaultWallet returned an unexpected transfer result");
}

const [senderBalance, recipientBalance] = await Promise.all([
  readHogBalance(sender.address),
  readHogBalance(recipient.address),
]);

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkId: client.network.networkId,
  sender: toHex0x(sender.address),
  recipient: toHex0x(recipient.address),
  airdropAmount: airdrop.rawAmount.toString(),
  airdropTxHash: toHex0x(airdrop.txHash),
  transferAmount: amount.toString(),
  transferTxHash: toHex0x(txHash),
  senderBalance: senderBalance.toString(),
  recipientBalance: recipientBalance.toString(),
});

async function readHogBalance(address: typeof sender.address): Promise<bigint> {
  const response = await ERC20.getBalanceOf.view({
    client: wallet,
    contract: HOG_ADDRESS,
    caller: sender.address,
    args: { addr: address },
  });
  return response.value;
}
