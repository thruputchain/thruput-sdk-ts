import {
  ContractType,
  contractAddress,
  codec,
  deserialize,
  serialize,
  sha256Hash,
  type Contract,
  type ContractAddress,
  type GasAmount,
  type SHA256Hash,
} from "@groundhogchain/protocol";
import { fixedBytes } from "@groundhogchain/xdr";
import { hashContract } from "../contract/hash.js";
import { deriveContractAddress } from "../derivation/contractAddress.js";
import { bytesEqual } from "../contract/event.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { WalletInvocationAdapter } from "./invocationAdapter.js";
import type { PrepareTransactionRequest } from "../actions/wallet/prepareTransaction.js";
import { toHex0x } from "../actions/hex.js";

/** Stable deployment inputs, available before prefunding and transaction preparation. */
export interface ContractDeployment {
  readonly contract: Contract;
  readonly deployer: ContractAddress;
  readonly deploymentNonce: SHA256Hash;
  readonly contractHash: SHA256Hash;
  readonly address: ContractAddress;
}

/** Wrap raw RV32 artifact bytes in the canonical protocol Contract. */
export function rv32Contract(artifact: Uint8Array): Contract {
  if (artifact.length === 0)
    throw new RangeError("RV32 artifact must not be empty");
  return {
    contract_type: ContractType.kRv32,
    rv32_contract: { data: new Uint8Array(artifact) },
  };
}

/** Hash canonical contract encoding and predict the address without creating an expiring transaction. */
export function prepareContractDeployment(input: {
  deployer: ContractAddress;
  contract: Contract | Uint8Array;
  deploymentNonce?: Uint8Array;
}): ContractDeployment {
  const contract =
    input.contract instanceof Uint8Array
      ? rv32Contract(input.contract)
      : deserialize(serialize(input.contract, codec.Contract), codec.Contract);
  const deployer = contractAddress(new Uint8Array(input.deployer));
  const deploymentNonce = sha256Hash(
    new Uint8Array(
      fixedBytes(
        input.deploymentNonce ?? crypto.getRandomValues(new Uint8Array(32)),
        32,
      ),
    ),
  );
  const contractHash = hashContract(contract);
  return {
    contract,
    deployer,
    deploymentNonce,
    contractHash,
    address: deriveContractAddress(deployer, deploymentNonce, contractHash),
  };
}

/** Build a wallet-specific root deployment and attach its canonical code bytes. */
export function deploymentRequest(
  deployment: ContractDeployment,
  account: ContractAddress,
  gasLimit: GasAmount,
  adapter: WalletInvocationAdapter,
): PrepareTransactionRequest {
  if (!adapter.createDeploymentInvocation)
    throw new Error("Wallet adapter does not support deployment");
  const snapshot = prepareContractDeployment(deployment);
  if (
    !bytesEqual(account, snapshot.deployer) ||
    !bytesEqual(snapshot.address, deployment.address) ||
    !bytesEqual(snapshot.contractHash, deployment.contractHash)
  )
    throw new Error(
      "Deployment inputs no longer match the predicted address or wallet account",
    );
  return {
    invocation: adapter.createDeploymentInvocation(account, gasLimit, snapshot),
    contractsToDeploy: [snapshot.contract],
  };
}

/** Verify committed deployment evidence against the pre-funded predicted address. */
export function decodeDeployment(
  receipt: TransactionReceipt,
  deployment: ContractDeployment,
  adapter: WalletInvocationAdapter,
): ContractAddress {
  if (!adapter.decodeDeploymentReceipt)
    throw new Error("Wallet adapter does not support deployment decoding");
  const address = adapter.decodeDeploymentReceipt(receipt);
  if (!bytesEqual(address, deployment.address))
    throw new Error(
      `Deployment ${toHex0x(receipt.txHash)} returned ${toHex0x(address)}, expected ${toHex0x(deployment.address)}`,
    );
  return address;
}
