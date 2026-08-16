import { randomBytes } from "node:crypto";
import {
  AuthClaimType,
  bitMap,
  blockHeight,
  codec,
  gasAmount,
  serialize,
  weight,
} from "@groundhogchain/protocol";
import {
  HttpTransport,
  addressFromHex,
  createGroundhogClient,
  createTransaction,
  signTransaction,
  toHex0x,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
import { DevWallet } from "./generated/dev_wallet.js";
import { loadLocalDevAccount } from "./helpers/local-dev.js";

const amount = 1000n;
const { address: senderAddress, signer, rpcUrl } = await loadLocalDevAccount();
const { address: recipientAddress } = await loadLocalDevAccount({
  localUserOffset: 1,
});

// HOG is predeployed on local/dev networks and implements the ERC20 interface.
const hogToken = addressFromHex(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);
const walletGasLimit = gasAmount(10_000_000n);
const callGasLimit = gasAmount(500_000n);

const client = createGroundhogClient(new HttpTransport(rpcUrl));
const tip = await client.getChainTip();

// Build the token call first: HOG.transfer(recipient, amount).
const tokenInvocation = ERC20.transfer.invocation(hogToken, callGasLimit, {
  receiver: recipientAddress,
  amount,
});

// Wallet accounts are contracts. The transaction calls the sender wallet, and
// the wallet performs the inner HOG transfer as its action.
const walletInvocation = DevWallet.doAction(senderAddress, walletGasLimit, {
  invocationBytes: serialize(tokenInvocation, codec.Invocation),
});

const tx = createTransaction({
  invocation: walletInvocation,
  uniquifier: {
    block_expiry_height: blockHeight(tip.height + 100n),
    nonce: randomBytes(8).readBigUInt64BE(),
  },
  contracts_to_deploy: [],
  auth_claim: {
    claim_type: AuthClaimType.kSourceAddressAuthData,
    source_address_claim: {
      allowed_keys: bitMap(0x01n),
      required_weight: weight(1n),
    },
  },
});

const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);
// Submission returns a hash; wait for its receipt when confirmation is needed.
const txHash = await client.sendTransaction(signed);

console.log({
  rpcUrl,
  hogToken: toHex0x(hogToken),
  from: toHex0x(senderAddress),
  to: toHex0x(recipientAddress),
  amount: amount.toString(),
  txHash: toHex0x(txHash),
});
