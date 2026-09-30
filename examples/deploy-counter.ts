import { readFile } from "node:fs/promises";
import { bitMap, weight } from "@groundhogchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  createGroundhogClient,
  createSourceAddressAccount,
  createWalletClient,
  devWalletAdapter,
  gasAmount,
  localnet,
  prepareContractDeployment,
  toHex0x,
} from "../src/index.js";
import { loadLocalDevAccount } from "../src/local-dev/index.js";
import { Counter } from "./generated/counter.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL;
if (rpcUrl && !process.env.GROUNDHOG_RUNTIME_MANIFEST) {
  throw new Error(
    "Set GROUNDHOG_RUNTIME_MANIFEST when overriding the Localnet RPC URL",
  );
}
const local = await loadLocalDevAccount();
const walletGasLimit = gasAmount(10_000_000n);
const counterGasLimit = gasAmount(500_000n);
const client = await createGroundhogClient({
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
  invocationAdapter: devWalletAdapter,
});
const artifact = await readFile(
  new URL("./fixtures/counter.rv32a", import.meta.url),
);
const deployment = prepareContractDeployment({
  deployer: account.address,
  contract: artifact,
});

// This local DevWallet transfers 10 HOG to the predicted address during deploy.
// It has no initializer option. This example's later increment is a separate transaction.
const deployed = await wallet.deployContractAndWait(deployment, walletGasLimit);
const invocation = Counter.v0_1.increment.invocation(
  deployed.address,
  counterGasLimit,
  { amount: 5n },
);
const executed = await wallet.executeAndWait({
  invocation,
  gasLimit: walletGasLimit,
});
const view = await Counter.v0_1.get.view({
  client,
  contract: deployed.address,
  caller: account.address,
});
if (view.value !== 5n)
  throw new Error(`Counter value is ${view.value}, expected 5`);

console.log({
  rpcUrl: client.cluster.rpcUrl,
  accountName: local.keyName,
  contractHash: toHex0x(deployment.contractHash),
  deploymentNonce: toHex0x(deployment.deploymentNonce),
  contractAddress: toHex0x(deployed.address),
  deployTxHash: toHex0x(deployed.txHash),
  callTxHash: toHex0x(executed.txHash),
  value: view.value.toString(),
});
