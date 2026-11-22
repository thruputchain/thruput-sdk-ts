/**
 * One error class with stable codes, typed context, and transaction facts.
 *
 * @module
 */
export {
  ThruputError,
  isThruputError,
  errorDocsBaseUrl,
  type SerializedThruputError,
  type ThruputErrorArgs,
  type ThruputErrorOf,
  type ThruputErrorOptions,
} from "./thruputError.js";
export { parseThruputError } from "./serialize.js";
export type {
  FundingStoppedContext,
  NativeRpcErrorContext,
  RpcErrorFields,
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
