import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ContractType,
  bitMap,
  gasAmount,
  sha256Hash,
  weight,
  type Contract,
} from "@groundhogchain/protocol";
import {
  connectGroundhogClient,
  createSourceAddressAccount,
  createWalletClient,
  deriveContractAddress,
  devWalletAdapter,
  fixedBytes,
  hashContract,
  localnet,
  toHex0x,
} from "../src/index.js";
import { DevWallet } from "../src/contracts/index.js";
import { loadLocalDevAccount } from "../src/local-dev/index.js";
import { Counter } from "./generated/counter.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL;
if (rpcUrl && !process.env.GROUNDHOG_RUNTIME_MANIFEST) {
  throw new Error(
    "Set GROUNDHOG_RUNTIME_MANIFEST when overriding the Localnet RPC URL",
  );
}
const local = await loadLocalDevAccount();
const deploymentNonce = sha256Hash(randomBytes(32));
const walletGasLimit = gasAmount(10_000_000n);
const counterGasLimit = gasAmount(500_000n);

const client = await connectGroundhogClient({
  cluster: localnet(rpcUrl ? { rpcUrl } : {}),
});
const account = createSourceAddressAccount({
  address: local.address,
  signers: [{ signer: local.signer, publicKeyId: 0n }],
  allowedKeys: bitMap(0x01n),
  requiredWeight: weight(1n),
});
const wallet = createWalletClient({
  client,
  account,
  networkHash: local.networkHash,
  invocationAdapter: devWalletAdapter,
});

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
  account.address,
  deploymentNonce,
  contractHash,
);

// Deployment is a wallet-specific root operation, so use the explicit escape
// hatch and include the artifact in this transaction.
const deployInvocation = DevWallet.deploy.invocation(
  account.address,
  walletGasLimit,
  {
    nonce: fixedBytes(deploymentNonce, 32),
    contractHash: fixedBytes(contractHash, 32),
  },
);
const deployHash = await wallet.sendInvocation({
  invocation: deployInvocation,
  contractsToDeploy: [contract],
});
const { value: returnedAddress } = DevWallet.deploy.decodeReceipt(
  await wallet.waitForTransactionReceipt(deployHash),
);
if (toHex0x(returnedAddress) !== toHex0x(deployedAddress)) {
  throw new Error(
    `Deployment returned ${toHex0x(returnedAddress)}, predicted ${toHex0x(deployedAddress)}`,
  );
}

// Normal contract calls are inner invocations wrapped by the configured
// DevWallet adapter.
const increment = Counter.increment.invocation(
  deployedAddress,
  counterGasLimit,
  { amount: 5n },
);
const callHash = await wallet.execute({
  invocation: increment,
  gasLimit: walletGasLimit,
});
DevWallet.doAction.decodeReceipt(
  await wallet.waitForTransactionReceipt(callHash),
);

const view = await Counter.get.view({
  client: wallet,
  contract: deployedAddress,
  caller: account.address,
});
if (view.value !== 5n) {
  throw new Error(`Counter value is ${view.value}, expected 5`);
}

console.log({
  rpcUrl: client.cluster.rpcUrl,
  accountName: local.keyName,
  contractHash: toHex0x(contractHash),
  deploymentNonce: toHex0x(deploymentNonce),
  contractAddress: toHex0x(deployedAddress),
  deployTxHash: toHex0x(deployHash),
  callTxHash: toHex0x(callHash),
  value: view.value.toString(),
});
