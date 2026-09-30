import { randomBytes } from "node:crypto";
import { HOG_ADDRESS, gasAmount } from "@groundhogchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  PrivateKeySigner,
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  devnet,
  parseUnits,
  toHex0x,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";

const amount = parseUnits("0.0001", 7); // HOG has seven decimal places.
// These budgets pass the live native-transfer test. Calibrate other workloads:
// declared root gas reserves scheduling capacity against the sender's free HOG.
const walletGasLimit = gasAmount(1_000_000n);
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
});

// This small transfer cannot cover a fresh recipient's balance-item deposit.
// Fund that item first. A sufficiently large first HOG transfer can also fund it;
// the required deposit depends on the runtime's storage-cost configuration.
const [senderAirdrop, recipientAirdrop] = await Promise.all([
  wallet.requestAirdrop(),
  client.requestAirdrop({ recipient: recipient.address }),
]);
if (senderAirdrop.status.result !== "ok") {
  throw new Error(
    `Sender airdrop transaction failed with ${senderAirdrop.status.result}`,
  );
}
if (recipientAirdrop.status.result !== "ok") {
  throw new Error(
    `Recipient airdrop transaction failed with ${recipientAirdrop.status.result}`,
  );
}
if (senderAirdrop.rawAmount < amount) {
  throw new Error(
    `Airdrop supplied ${senderAirdrop.rawAmount} base units, fewer than the ${amount} requested for transfer`,
  );
}

const transfer = ERC20.v0_1.transfer.invocation(HOG_ADDRESS, callGasLimit, {
  receiver: recipient.address,
  amount,
});
const { txHash } = await wallet.executeAndWait({
  invocation: transfer,
  gasLimit: walletGasLimit,
});

const [senderBalance, recipientBalance] = await Promise.all([
  readHogBalance(sender.address),
  readHogBalance(recipient.address),
]);

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkHash: toHex0x(client.network.networkHash),
  sender: toHex0x(sender.address),
  recipient: toHex0x(recipient.address),
  senderAirdropAmount: senderAirdrop.rawAmount.toString(),
  senderAirdropTxHash: toHex0x(senderAirdrop.txHash),
  recipientAirdropAmount: recipientAirdrop.rawAmount.toString(),
  recipientAirdropTxHash: toHex0x(recipientAirdrop.txHash),
  transferAmount: amount.toString(),
  transferTxHash: toHex0x(txHash),
  senderBalance: senderBalance.toString(),
  recipientBalance: recipientBalance.toString(),
});

async function readHogBalance(address: typeof sender.address): Promise<bigint> {
  const response = await ERC20.v0_1.getBalanceOf.view({
    client: wallet,
    contract: HOG_ADDRESS,
    caller: sender.address,
    args: { addr: address },
  });
  return response.value;
}
