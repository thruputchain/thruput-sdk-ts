import type {
  Invocation,
  Transaction,
  ContractAddress,
  ContractEntrypointID,
  GasAmount,
  Calldata,
  Uniquifier,
  AuthClaim,
  Contract,
} from "@groundhogchain/protocol";

export function createInvocation(params: {
  invoked_address: ContractAddress;
  entrypoint: ContractEntrypointID;
  gas_limit: GasAmount;
  calldata: Calldata;
}): Invocation {
  return {
    invoked_address: params.invoked_address,
    entrypoint: params.entrypoint,
    gas_limit: params.gas_limit,
    calldata: params.calldata,
  };
}

export function createTransaction(params: {
  invocation: Invocation;
  uniquifier: Uniquifier;
  contracts_to_deploy: Contract[];
  auth_claim: AuthClaim;
}): Transaction {
  return {
    invocation: params.invocation,
    uniquifier: params.uniquifier,
    contracts_to_deploy: params.contracts_to_deploy,
    auth_claim: params.auth_claim,
  };
}
