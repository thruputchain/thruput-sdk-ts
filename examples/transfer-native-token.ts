import { randomBytes } from "node:crypto";
import { NATIVE_TOKEN_ADDRESS, gasAmount } from "@thruputchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  Ed25519Signer,
  createThruputClient,
  createPubkeyAccount,
  createWalletClient,
  devnet,
  parseUnits,
  toBase58,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";

const amount = parseUnits("0.0001", 7); // The native token has seven decimal places.
// These budgets pass the live native-transfer test. Calibrate other workloads:
// declared root gas reserves scheduling capacity against the sender's free
// native-token balance.
const walletGasLimit = gasAmount(1_000_000n);
const callGasLimit = gasAmount(500_000n);
const rpcUrl = process.env.THRUPUT_RPC_URL;

// These accounts exist only for this process. Their keys are not persisted.
const sender = createPubkeyAccount({
  signer: Ed25519Signer.fromSeed(randomBytes(32)),
});
const recipient = createPubkeyAccount({
  signer: Ed25519Signer.fromSeed(randomBytes(32)),
});

const client = await createThruputClient({
  cluster: devnet(rpcUrl ? { rpcUrl } : {}),
});
const wallet = createWalletClient({
  client,
  account: sender,
});

// This small transfer cannot cover a fresh recipient's balance-item deposit.
// Fund that item first. A sufficiently large first native-token transfer can
// also fund it; the required deposit depends on the runtime's storage-cost
// configuration.
const [senderAirdrop, recipientAirdrop] = await Promise.all([
  wallet.requestAirdrop(),
  client.requestAirdrop({ recipient: recipient.address }),
]);
if (senderAirdrop.rawAmount < amount) {
  throw new Error(
    `Airdrop supplied ${senderAirdrop.rawAmount} base units, fewer than the ${amount} requested for transfer`,
  );
}

const transfer = ERC20.v0_1.transfer.invocation(
  NATIVE_TOKEN_ADDRESS,
  callGasLimit,
  {
    receiver: recipient.address,
    amount,
  },
);
const { transactionHash } = await wallet.executeAndWait({
  invocation: transfer,
  gasLimit: walletGasLimit,
});

const [senderBalance, recipientBalance] = await Promise.all([
  readNativeTokenBalance(sender.address),
  readNativeTokenBalance(recipient.address),
]);

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkHash: toBase58(client.network.networkHash),
  sender: toBase58(sender.address),
  recipient: toBase58(recipient.address),
  senderAirdropAmount: senderAirdrop.rawAmount.toString(),
  senderAirdropTxHash: toBase58(senderAirdrop.transactionHash),
  recipientAirdropAmount: recipientAirdrop.rawAmount.toString(),
  recipientAirdropTxHash: toBase58(recipientAirdrop.transactionHash),
  transferAmount: amount.toString(),
  transferTxHash: toBase58(transactionHash),
  senderBalance: senderBalance.toString(),
  recipientBalance: recipientBalance.toString(),
});

async function readNativeTokenBalance(
  address: typeof sender.address,
): Promise<bigint> {
  const response = await ERC20.v0_1.getBalanceOf.view({
    client: wallet,
    address: NATIVE_TOKEN_ADDRESS,
    caller: sender.address,
    args: { addr: address },
  });
  return response.value;
}
