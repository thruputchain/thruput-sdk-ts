import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AuthClaimType,
  ContractType,
  CxsReader,
  CxsWriter,
  ExecResult,
  Uint64Codec,
  bitMap,
  blockHeight,
  calldata,
  codec,
  contractAddress,
  contractEntrypointID,
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
  PrivateKeySigner,
  addressFromHex,
  createGroundhogClient,
  createInvocation,
  createTransaction,
  deriveContractAddress,
  fromHex0x,
  hashContract,
  signTransaction,
  toHex0x,
} from "../src/index.js";
import { Counter } from "./generated/counter.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";
const senderAddress = addressFromHex(
  process.env.GROUNDHOG_SENDER_ADDRESS ??
    "0x8bb77020223781a5653404392b824efe17574924c5a41b4995c8f034a8ed9229",
);
const senderPrivateKey = fromHex0x(
  process.env.GROUNDHOG_SENDER_PRIVATE_KEY ??
    "0x9b0da61c2f4271584ebb7629c54213edef7328d429ebcca39c83686d81d166ca",
);
const walletDeployEntrypoint = contractEntrypointID(
  fromHex0x(
    process.env.GROUNDHOG_WALLET_DEPLOY_ENTRYPOINT ?? "0xf969542572bd6860",
  ),
);
const walletActionEntrypoint = contractEntrypointID(
  fromHex0x(process.env.GROUNDHOG_WALLET_ENTRYPOINT ?? "0xa0fff94c64fbaf3c"),
);
const deploymentNonce = sha256Hash(
  process.env.GROUNDHOG_DEPLOYMENT_NONCE
    ? fromHex0x(process.env.GROUNDHOG_DEPLOYMENT_NONCE)
    : randomBytes(32),
);

const walletGasLimit = gasAmount(10_000_000n);
const counterGasLimit = gasAmount(500_000n);
const sourceAuthClaim: AuthClaim = {
  claim_type: AuthClaimType.kSourceAddressAuthData,
  source_address_claim: {
    allowed_keys: bitMap(0x01n),
    required_weight: weight(1n),
  },
};

const client = createGroundhogClient(
  new HttpTransport(rpcUrl, { timeoutMs: 5_000 }),
);
const signer = new PrivateKeySigner(senderPrivateKey);
let transactionNonce = randomBytes(8).readBigUInt64BE() % ((1n << 64n) - 1n);

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

const deploymentCalldata = new CxsWriter();
deploymentCalldata.writeFixedOpaque(deploymentNonce, 32);
deploymentCalldata.writeFixedOpaque(contractHash, 32);
const deployInvocation = createInvocation({
  invoked_address: senderAddress,
  entrypoint: walletDeployEntrypoint,
  gas_limit: walletGasLimit,
  calldata: calldata(deploymentCalldata.finish()),
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

const increment = Counter.increment(deployedAddress, counterGasLimit, {
  amount: 5n,
});
const callHash = await submit(wrapInWalletInvocation(increment), []);
const callReceipt = await client.waitForTransactionReceipt(callHash);
if (callReceipt.execResult !== ExecResult.ExecResultOK) {
  const abort = callReceipt.abortData
    ? `, abort data ${toHex0x(callReceipt.abortData)}`
    : "";
  throw new Error(
    `Counter increment failed with ${ExecResult[callReceipt.execResult]}${abort}`,
  );
}

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
  const tip = await client.getChainTip();
  const tx = createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(tip.height + 100n),
      nonce: transactionNonce++,
    },
    contracts_to_deploy: contractsToDeploy,
    auth_claim: sourceAuthClaim,
  });
  const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);
  return client.sendTransaction(signed);
}

function wrapInWalletInvocation(invocation: Invocation): Invocation {
  const writer = new CxsWriter();
  writer.writeVarOpaque(serialize(invocation, codec.Invocation), 0xffffffff);
  return createInvocation({
    invoked_address: senderAddress,
    entrypoint: walletActionEntrypoint,
    gas_limit: walletGasLimit,
    calldata: calldata(writer.finish()),
  });
}
