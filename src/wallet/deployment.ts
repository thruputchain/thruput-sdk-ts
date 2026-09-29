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
  /**
   * HOG base units the wallet transfers to {@link address} in the deploying
   * transaction, before the code is deployed. It must cover the new
   * contract's storage deposit and any state the initializer creates. Zero or
   * absent skips funding, so the address must already hold what it needs.
   */
  readonly funding?: bigint;
  /**
   * An ordinary call the wallet makes to the new contract right after
   * deploying it, in the same transaction; build it with the contract's
   * generated binding against {@link address}. Its caller is the wallet, its
   * return value is discarded, and its failure rolls back funding and
   * deployment too. The root gas limit must cover its `gas_limit`.
   */
  readonly initializer?: Invocation;
}

const MAX_U128 = (1n << 128n) - 1n;

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
 * expiring transaction. The address's storage must be funded before the code
 * lands: either transfer HOG to it first, or set `funding` so a wallet that
 * supports it (DefaultWallet) transfers it in the deploying transaction. An
 * `initializer` must target the predicted address; to build one with a
 * generated binding, prepare once, then spread the result with the
 * initializer added. The deployment nonce differs from the transaction nonce.
 * Factory-created contracts remain factory calls with attached code.
 *
 * @example
 * ```ts
 * const planned = prepareContractDeployment({
 *   deployer: account.address,
 *   contract: artifact,
 *   funding: 10_000_000n,
 * });
 * const deployment = {
 *   ...planned,
 *   initializer: Counter.v0_1.initialize.invocation(planned.address, initGas, {
 *     initialValue: 7n,
 *   }),
 * };
 * await wallet.deployContractAndWait(deployment, rootGas);
 * ```
 */
export function prepareContractDeployment(input: {
  deployer: ContractAddress;
  contract: Contract | Uint8Array;
  deploymentNonce?: Uint8Array;
  funding?: bigint;
  initializer?: Invocation;
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
  const address = deriveContractAddress(
    deployer,
    deploymentNonce,
    contractHash,
  );
  const funding = input.funding ?? 0n;
  if (funding < 0n || funding > MAX_U128)
    throw new RangeError(
      "Deployment funding must fit in an unsigned 128-bit amount",
    );
  let initializer: Invocation | undefined;
  if (input.initializer) {
    if (!bytesEqual(input.initializer.invoked_address, address))
      throw new Error(
        `Deployment initializer targets ${toHex0x(input.initializer.invoked_address)}, not the deployed address ${toHex0x(address)}`,
      );
    initializer = deserialize(
      serialize(input.initializer, codec.Invocation),
      codec.Invocation,
    );
  }
  return {
    contract,
    deployer,
    deploymentNonce,
    contractHash,
    address,
    ...(funding > 0n ? { funding } : {}),
    ...(initializer ? { initializer } : {}),
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
