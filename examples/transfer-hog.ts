import {
  AuthClaimType,
  CxsWriter,
  bitMap,
  blockHeight,
  calldata,
  codec,
  contractEntrypointID,
  gasAmount,
  serialize,
  weight,
} from "@groundhogchain/protocol";
import type { ContractAddress, Invocation } from "@groundhogchain/protocol";
import {
  HttpTransport,
  PrivateKeySigner,
  addressFromHex,
  createGroundhogClient,
  createTransaction,
  fromHex0x,
  signTransaction,
  toHex0x,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";
const amount = 1000n;
const senderAddress = addressFromHex(
  process.env.GROUNDHOG_SENDER_ADDRESS ??
    "0x7171717171717171717171717171717171717171717171717171717171717171",
);
const recipientAddress = addressFromHex(
  process.env.GROUNDHOG_RECIPIENT_ADDRESS ??
    "0x7272727272727272727272727272727272727272727272727272727272727272",
);
const senderPrivateKey = fromHex0x(
  process.env.GROUNDHOG_SENDER_PRIVATE_KEY ??
    "0x9b0da61c2f4271584ebb7629c54213edef7328d429ebcca39c83686d81d166ca",
);

// HOG is predeployed on local/dev networks and implements the ERC20 interface.
const hogToken = addressFromHex(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);
const walletGasLimit = gasAmount(10_000_000n);
const callGasLimit = gasAmount(500_000n);
// TODO: replace this with a generated smart-wallet binding or wallet helper.
const walletEntrypoint = contractEntrypointID(
  fromHex0x(process.env.GROUNDHOG_WALLET_ENTRYPOINT ?? "0x646f416374696f6e"),
);

const client = createGroundhogClient(new HttpTransport(rpcUrl));
const signer = new PrivateKeySigner(senderPrivateKey);
const tip = await client.getChainTip();

// Build the token call first: HOG.transfer(recipient, amount).
const tokenInvocation = ERC20.transfer(hogToken, callGasLimit, {
  to: recipientAddress,
  amount,
});

// Wallet accounts are contracts. The transaction calls the sender wallet, and
// the wallet performs the inner HOG transfer as its action.
const walletInvocation = wrapInWalletInvocation(tokenInvocation, senderAddress);

const tx = createTransaction({
  invocation: walletInvocation,
  uniquifier: {
    block_expiry_height: blockHeight(tip.height + 100n),
    nonce:
      BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
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
const txHash = await client.sendTransaction(signed);

console.log({
  rpcUrl,
  hogToken: toHex0x(hogToken),
  from: toHex0x(senderAddress),
  to: toHex0x(recipientAddress),
  amount: amount.toString(),
  txHash: toHex0x(txHash),
});

function wrapInWalletInvocation(
  invocation: Invocation,
  walletAddress: ContractAddress,
): Invocation {
  // The wallet expects the inner invocation as one CXS var-opaque blob.
  const inner = serialize(invocation, codec.Invocation);
  const writer = new CxsWriter();
  writer.writeVarOpaque(inner, 0xffffffff);

  return {
    invoked_address: walletAddress,
    entrypoint: walletEntrypoint,
    gas_limit: walletGasLimit,
    calldata: calldata(writer.finish()),
  };
}
