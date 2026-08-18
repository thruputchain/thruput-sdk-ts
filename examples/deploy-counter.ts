import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
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
  ContractAddress,
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
import type { TransactionReceipt } from "../src/index.js";
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
const receiptTimeoutMs = 30_000;
const receiptPollMs = 250;
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
const predictedAddress = deriveContractAddress(
  senderAddress,
  deploymentNonce,
  contractHash,
);

const deployInvocation = createInvocation({
  invoked_address: senderAddress,
  entrypoint: walletDeployEntrypoint,
  gas_limit: walletGasLimit,
  calldata: encodeDeployCalldata(deploymentNonce, contractHash),
});
const deployHash = await submit(deployInvocation, [contract]);
const deployReceipt = await waitForSuccessfulReceipt(deployHash, "deployment");
const deployedAddress = resolveDeployedAddress(deployReceipt, predictedAddress);

const increment = Counter.increment(deployedAddress, counterGasLimit, {
  amount: 5n,
});
const callHash = await submit(wrapWalletAction(increment), []);
await waitForSuccessfulReceipt(callHash, "counter increment");

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

async function waitForSuccessfulReceipt(
  txHash: SHA256Hash,
  operation: string,
): Promise<TransactionReceipt> {
  const deadline = Date.now() + receiptTimeoutMs;
  let advisoryFailure: string | undefined;
  while (Date.now() < deadline) {
    const receipt = await client.getTransactionReceipt(txHash);
    if (receipt) {
      if (receipt.execResult !== ExecResult.ExecResultOK) {
        const abort = receipt.abortData
          ? `, abort data ${toHex0x(receipt.abortData)}`
          : "";
        throw new Error(
          `${operation} failed with ${ExecResult[receipt.execResult]}${abort}`,
        );
      }
      return receipt;
    }

    const status = await client.getTransactionStatus(txHash);
    if (status.status === "invalid") {
      throw new Error(`${operation} was rejected: ${status.reason}`);
    }
    if (status.status === "recentFailure") {
      advisoryFailure =
        `Last advisory failure at height ${status.attemptHeight}: ` +
        `${status.conflict.code} conflict at ${toHex0x(status.conflict.address)} ` +
        `key ${toHex0x(status.conflict.key)}`;
    }
    await delay(receiptPollMs);
  }
  throw new Error(
    `Timed out waiting for ${operation} receipt ${toHex0x(txHash)}` +
      (advisoryFailure ? `. ${advisoryFailure}` : ""),
  );
}

function resolveDeployedAddress(
  receipt: TransactionReceipt,
  predicted: ContractAddress,
): ContractAddress {
  if (receipt.returnData === null) return predicted;
  const returned = contractAddress(receipt.returnData);
  if (toHex0x(returned) !== toHex0x(predicted)) {
    throw new Error(
      `Deployment returned ${toHex0x(returned)}, predicted ${toHex0x(predicted)}`,
    );
  }
  return returned;
}

function encodeDeployCalldata(nonce: SHA256Hash, contractHash: SHA256Hash) {
  const writer = new CxsWriter();
  writer.writeFixedOpaque(nonce, 32);
  writer.writeFixedOpaque(contractHash, 32);
  return calldata(writer.finish());
}

function wrapWalletAction(invocation: Invocation): Invocation {
  const writer = new CxsWriter();
  writer.writeVarOpaque(serialize(invocation, codec.Invocation), 0xffffffff);
  return createInvocation({
    invoked_address: senderAddress,
    entrypoint: walletActionEntrypoint,
    gas_limit: walletGasLimit,
    calldata: calldata(writer.finish()),
  });
}
