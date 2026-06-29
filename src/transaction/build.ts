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

/**
 * Build an invocation object from already-typed protocol values.
 *
 * Generated contract bindings usually call this helper for you. Use it directly
 * when constructing a low-level invocation without generated bindings.
 */
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

/**
 * Build an unsigned transaction from an invocation and authorization metadata.
 *
 * The returned transaction must be signed with {@link signTransaction} before it
 * can be submitted to a Groundhog JSON-RPC gateway.
 */
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
