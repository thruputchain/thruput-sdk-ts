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
import { transfer } from "../src/contracts/erc20.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";
const amount = 1000n;

// HOG is predeployed on local/dev networks and implements the ERC20 interface.
const hogToken = addressFromHex(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);
const walletGasLimit = gasAmount(10_000_000n);
const callGasLimit = gasAmount(500_000n);
// TODO: replace this with a generated dev-wallet binding or SDK helper.
// This is the local dev wallet `doAction(Invocation)` entrypoint.
const devWalletDoActionEntrypointHex = "0x19846d750fad81d6";
const walletDoActionEntrypoint = contractEntrypointID(
  fromHex0x(devWalletDoActionEntrypointHex),
);

const client = createGroundhogClient(new HttpTransport(rpcUrl));

// This is a local-dev-helper script. It needs a dev node exposing
// `groundhog_dev_getAccounts` so it can load bootstrap wallet keys.
const accounts = await client.dev.getAccounts();

if (accounts.length < 2) {
  throw new Error("transfer-hog requires at least two dev accounts");
}

const sender = accounts[0];
const recipient = accounts[1];
const signer = new PrivateKeySigner(sender.privateKey);
const tip = await client.getChainTip();

// Build the token call first: HOG.transfer(dev-1, amount).
const tokenInvocation = transfer(hogToken, callGasLimit, {
  to: recipient.address,
  amount,
});

// Dev accounts are wallet contracts. The transaction calls the sender wallet,
// and the wallet performs the inner HOG transfer as its action.
const walletInvocation = wrapInWalletInvocation(
  tokenInvocation,
  sender.address,
);

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
  from: toHex0x(sender.address),
  to: toHex0x(recipient.address),
  amount: amount.toString(),
  txHash: toHex0x(txHash),
});

function wrapInWalletInvocation(
  invocation: Invocation,
  walletAddress: ContractAddress,
): Invocation {
  // The dev wallet expects the inner invocation as one CXS var-opaque blob.
  const inner = serialize(invocation, codec.Invocation);
  const writer = new CxsWriter();
  writer.writeVarOpaque(inner, 0xffffffff);

  return {
    invoked_address: walletAddress,
    entrypoint: walletDoActionEntrypoint,
    gas_limit: walletGasLimit,
    calldata: calldata(writer.finish()),
  };
}
