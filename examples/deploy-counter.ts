import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gasAmount } from "@thruputchain/protocol";
import {
  PrivateKeySigner,
  createThruputClient,
  createPubkeyAccount,
  createWalletClient,
  localnet,
  prepareContractDeployment,
  toHex0x,
  toBase58,
} from "../src/index.js";
import { Counter } from "./generated/counter.js";

const rpcUrl = process.env.THRUPUT_RPC_URL;
if (rpcUrl && !process.env.THRUPUT_RUNTIME_MANIFEST) {
  throw new Error(
    "Set THRUPUT_RUNTIME_MANIFEST when overriding the Localnet RPC URL",
  );
}
const walletGasLimit = gasAmount(10_000_000n);
const counterGasLimit = gasAmount(500_000n);
const client = await createThruputClient({
  cluster: localnet(rpcUrl ? { rpcUrl } : {}),
});

// This fresh native account starts empty. Its key exists only for this process.
const account = createPubkeyAccount({
  signer: new PrivateKeySigner(randomBytes(32)),
});
const wallet = createWalletClient({ client, account });
const airdrop = await wallet.requestAirdrop();
if (airdrop.status.result !== "ok") {
  throw new Error(`Airdrop transaction failed with ${airdrop.status.result}`);
}

// Prepare the address first so the initializer can target the new contract.
const deployment = prepareContractDeployment({
  deployer: account.address,
  contract: await readFile(
    new URL("./fixtures/counter.rv32a", import.meta.url),
  ),
});
const { address, txHash: deployHash } = await wallet.deployContractAndWait(
  deployment,
  {
    gasLimit: walletGasLimit,
    // Explicit storage funding in raw HOG units; calibrated for this fixture.
    amount: 50_000_000n,
    initializer: Counter.v0_1.initialize.invocation(
      deployment.address,
      counterGasLimit,
      { initialValue: 42n },
    ),
  },
);

const { txHash: callHash } = await wallet.executeAndWait({
  invocation: Counter.v0_1.increment.invocation(address, counterGasLimit, {
    amount: 5n,
  }),
  gasLimit: walletGasLimit,
});
const view = await Counter.v0_1.get.view({
  client: wallet,
  contract: address,
  caller: account.address,
});
if (view.value !== 47n) {
  throw new Error(`Counter value is ${view.value}, expected 47`);
}

console.log({
  rpcUrl: client.cluster.rpcUrl,
  account: toBase58(account.address),
  airdropTxHash: toBase58(airdrop.txHash),
  contractHash: toBase58(deployment.contractHash),
  deploymentNonce: toHex0x(deployment.deploymentNonce),
  contractAddress: toBase58(address),
  deployTxHash: toBase58(deployHash),
  callTxHash: toBase58(callHash),
  value: view.value.toString(),
});
