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
  type Invocation,
  type SHA256Hash,
} from "@thruputchain/protocol";
import { fixedBytes } from "@thruputchain/xdr";
import { hashContract } from "../contract/hash.js";
import { deriveContractAddress } from "../derivation/contractAddress.js";
import { bytesEqual } from "../contract/event.js";
import type { TransactionReceipt } from "../types/rpc.js";
import type { WalletInvocationAdapter } from "./invocationAdapter.js";
import type { PrepareTransactionRequest } from "../actions/wallet/prepareTransaction.js";
import { toBase58 } from "../encoding.js";
import {
  assertTransactionSuccess,
  ExecutionDecodeError,
  type SubmissionEvidence,
} from "./execution.js";

/** Stable deployment identity, available before transaction preparation. */
export interface ContractDeployment {
  readonly contract: Contract;
  readonly deployer: ContractAddress;
  readonly deploymentNonce: SHA256Hash;
  readonly contractHash: SHA256Hash;
  readonly address: ContractAddress;
}

/** Explicit effects and gas budgets for one atomic wallet deployment. */
export interface DeploymentOptions {
  /** Gas available to the complete wallet root. */
  readonly gasLimit: GasAmount;
  /** Exact raw HOG to transfer to the target. Zero skips funding. */
  readonly amount: bigint;
  /**
   * Optional ordinary call to the predicted deployment address. Build it with
   * a generated method's invocation API. The caller is the wallet; return data
   * is discarded. Failure rolls back funding, deployment and initialization.
   */
  readonly initializer?: Invocation;
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

/**
 * Hash canonical contract encoding and predict the address without creating an
 * expiring transaction. Funding and initialization are explicit deployment options;
 * this helper performs neither. The deployment nonce differs from the transaction
 * nonce. Factory-created contracts remain factory calls with attached code.
 */
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
  options: DeploymentOptions,
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
    invocation: adapter.createDeploymentInvocation(account, snapshot, options),
    contractsToDeploy: [snapshot.contract],
  };
}

/** Verify committed deployment evidence against the predicted address. */
export function decodeDeployment(
  receipt: TransactionReceipt,
  deployment: ContractDeployment,
  adapter: WalletInvocationAdapter,
  submission?: SubmissionEvidence,
): ContractAddress {
  assertTransactionSuccess(receipt, submission);
  try {
    if (!adapter.decodeDeploymentReceipt)
      throw new Error("Wallet adapter does not support deployment decoding");
    const address = adapter.decodeDeploymentReceipt(receipt);
    if (!bytesEqual(address, deployment.address))
      throw new Error(
        `Deployment ${toBase58(receipt.transactionHash)} returned ${toBase58(address)}, expected ${toBase58(deployment.address)}`,
      );
    return address;
  } catch (cause) {
    throw new ExecutionDecodeError(receipt, cause, submission);
  }
}
