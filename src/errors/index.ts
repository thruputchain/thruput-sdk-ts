/**
 * One error class with stable codes, typed context, and transaction facts.
 *
 * @module
 */
export {
  ThruputError,
  isThruputError,
  type ThruputErrorOf,
  type ThruputErrorOptions,
} from "./thruputError.js";
export { transactionErrorCodes, type TransactionErrorCode } from "./codes.js";
export type {
  FundingStoppedContext,
  NativeRpcErrorContext,
  RpcErrorFields,
  RpcIncompatibleKind,
  ThruputErrorCode,
  ThruputErrorContext,
  TransactionOutcomeUnknownContext,
  WalletErrorContext,
} from "./codes.js";
export {
  transactionOutcomes,
  transactionReasons,
  type TransactionFacts,
  type TransactionFactsInput,
  type TransactionOutcome,
  type TransactionReason,
} from "./transaction.js";
