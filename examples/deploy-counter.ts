import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AuthClaimType,
  ContractType,
  CxsReader,
  ExecResult,
  Uint64Codec,
  bitMap,
  blockHeight,
  codec,
  contractAddress,
  gasAmount,
  serialize,
  sha256Hash,
  weight,
} from "@groundhogchain/protocol";
import type {
  AuthClaim,
  Contract,
  Invocation,
  SHA256Hash,
} from "@groundhogchain/protocol";
import {
  HttpTransport,
  createGroundhogClient,
  createTransaction,
  deriveContractAddress,
  hashContract,
  signTransaction,
  toHex0x,
} from "../src/index.js";
import { Counter } from "./generated/counter.js";
import { DevWallet } from "./generated/dev_wallet.js";
import { loadLocalDevAccount } from "./helpers/local-dev.js";

const { address: senderAddress, signer, rpcUrl } = await loadLocalDevAccount();
const deploymentNonce = sha256Hash(randomBytes(32));

const walletGasLimit = gasAmount(10_000_000n);
const counterGasLimit = gasAmount(500_000n);
// Authorize key 0 with the wallet's required weight of 1.
const sourceAuthClaim: AuthClaim = {
  claim_type: AuthClaimType.kSourceAddressAuthData,
  source_address_claim: {
    allowed_keys: bitMap(0x01n),
    required_weight: weight(1n),
  },
};

// Connect to the node and prepare the signer for the outer transaction.
const client = createGroundhogClient(
  new HttpTransport(rpcUrl, { timeoutMs: 5_000 }),
);

// Load the compiled contract and derive the address before deploying it.
const artifact = await readFile(
  new URL("./fixtures/counter.rv32a", import.meta.url),
);
const contract: Contract = {
  contract_type: ContractType.kRv32,
  rv32_contract: { data: artifact },
};
const contractHash = hashContract(contract);
const deployedAddress = deriveContractAddress(
  senderAddress,
  deploymentNonce,
  contractHash,
);

// Deploy through the sender's DevWallet and wait for the transaction to commit.
const deployInvocation = DevWallet.deploy(senderAddress, walletGasLimit, {
  nonce: deploymentNonce,
  contractHash,
});
const deployHash = await submit(deployInvocation, [contract]);
const deployReceipt = await client.waitForTransactionReceipt(deployHash);
if (deployReceipt.execResult !== ExecResult.ExecResultOK) {
  const abort = deployReceipt.abortData
    ? `, abort data ${toHex0x(deployReceipt.abortData)}`
    : "";
  throw new Error(
    `Deployment failed with ${ExecResult[deployReceipt.execResult]}${abort}`,
  );
}
if (deployReceipt.returnData !== null) {
  const returnedAddress = contractAddress(deployReceipt.returnData);
  if (toHex0x(returnedAddress) !== toHex0x(deployedAddress)) {
    throw new Error(
      `Deployment returned ${toHex0x(returnedAddress)}, predicted ${toHex0x(deployedAddress)}`,
    );
  }
}

// Build a Counter.increment call, then ask the wallet to execute it.
const increment = Counter.increment(deployedAddress, counterGasLimit, {
  amount: 5n,
});
const walletInvocation = DevWallet.doAction(senderAddress, walletGasLimit, {
  invocationBytes: serialize(increment, codec.Invocation),
});
const callHash = await submit(walletInvocation, []);
const callReceipt = await client.waitForTransactionReceipt(callHash);
if (callReceipt.execResult !== ExecResult.ExecResultOK) {
  const abort = callReceipt.abortData
    ? `, abort data ${toHex0x(callReceipt.abortData)}`
    : "";
  throw new Error(
    `Counter increment failed with ${ExecResult[callReceipt.execResult]}${abort}`,
  );
}

// Read the committed value without submitting another transaction.
const get = Counter.get(deployedAddress, counterGasLimit);
const view = await client.view({
  contract: get.invoked_address,
  entrypoint: get.entrypoint,
  calldata: get.calldata,
  caller: senderAddress,
});
if (view.output.result === "abort") {
  throw new Error(
    `Counter view aborted with ${toHex0x(view.output.abortData)}`,
  );
}
if (view.output.result !== "return") {
  throw new Error(`Counter view did not return: ${view.output.result}`);
}
const reader = new CxsReader(view.output.returnData);
const value = Uint64Codec.decode(reader);
if (reader.remaining !== 0) {
  throw new Error(`Counter view returned ${reader.remaining} trailing bytes`);
}
if (value !== 5n) {
  throw new Error(`Counter value is ${value}, expected 5`);
}

console.log({
  rpcUrl,
  contractHash: toHex0x(contractHash),
  deploymentNonce: toHex0x(deploymentNonce),
  contractAddress: toHex0x(deployedAddress),
  deployTxHash: toHex0x(deployHash),
  callTxHash: toHex0x(callHash),
  value: value.toString(),
});

async function submit(
  invocation: Invocation,
  contractsToDeploy: Contract[],
): Promise<SHA256Hash> {
  // This replay-protection nonce is separate from the deployment nonce above.
  const tip = await client.getChainTip();
  const tx = createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(tip.height + 100n),
      nonce: randomBytes(8).readBigUInt64BE(),
    },
    contracts_to_deploy: contractsToDeploy,
    auth_claim: sourceAuthClaim,
  });
  const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);
  return client.sendTransaction(signed);
}
