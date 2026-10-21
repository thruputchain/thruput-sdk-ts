/** SDK workflow names share the generated native wire-14 shapes and byte/bigint codecs. */
import type * as Native from "../rpc/generated.js";

export type AuthPublicKey = Native.RpcPublicKey;
export type AuthSigner = Native.RpcAuthSigner;
export type AddressAuthDataInfo = Native.RpcAuthConfiguration;
export type RegisteredAuthResult = Native.RpcRegisteredAuthResult;
export type NetworkInfo = Native.RpcNetworkInfo;
export type NetworkConfigParams = Native.RpcConfigLimits;
export type ChainConfig = Native.RpcChainConfig;
export type ExecutionConfig = Native.RpcExecutionConfig;
export type StorageCosts = Native.RpcStorageCosts;
export type SimulationBatchLimits = Native.RpcSimulationBatchLimits;
export type ServerLimits = Native.RpcServerLimits;
export type AirdropAttemptRequest = Native.RpcRequests["faucet_requestAirdrop"];
export type AirdropExecutionStatus = Native.RpcAirdropExecution;
export type AirdropPending = Extract<
  Native.RpcAirdropAttempt,
  { attemptStatus: "pending" }
>;
export type AirdropSucceeded = Extract<
  Native.RpcAirdropAttempt,
  { attemptStatus: "succeeded" }
>;
export type AirdropResponse = Native.RpcAirdropAttempt;
export type ChainTip = Native.RpcChainTip;
export type BalanceResponse = Native.RpcBalanceResult;
export type BlockInfo = Native.RpcBlockInfo;
export type VersionInfo = Native.RpcVersionInfo;
/** Prepared descriptor reads retain .view conveniences while using native invocation shapes. */
export type ViewCall = Native.RpcInvocation;
export type ViewRequest = Native.RpcRequests["simulateInvocation"];
export type ViewBatchRequest = Native.RpcRequests["simulateInvocations"];
export type ViewBatchResponse = Native.RpcSimulationResults;
export type ViewOutput = Native.RpcInvocationOutput;
export type ViewResponse = Native.RpcSimulationResult;
export type TransactionStatus = Native.RpcTransactionStatus;
export type SchedulerTransactionError = Native.RpcSchedulerError;
export type TransactionFailureCause = Native.RpcFailureCause;
/** Best-effort failed-attempt evidence; it need not describe the current scheduler attempt. */
export type RecentAttemptFailure = Native.RpcRecentAttemptFailure;
export type ContractRejectCode = Native.RpcContractRejectCode;
export type ConflictCode = Native.RpcConflictCode;
export type ConflictDiagnostic = Native.RpcConflictDiagnostic;
export type TransactionRef = Native.RpcTransactionRef;
export type TransactionRefPage = Native.RpcTransactionRefPage;
export type TransactionReceipt = Native.RpcTransactionReceipt;
export type EmittedEvent = Native.RpcEmittedEvent;
export type IdentifiedEvent = Native.RpcIdentifiedEvent;
export type EventPage = Native.RpcEventPage;
export type EventFilter = Native.RpcEventFilter;
export type HistoryStart = Native.RpcHistoryStart;
export type IterationOrder = Native.RpcIterationOrder;
export type EventQuery = Native.RpcRequests["getEvents"];
export type BlockTransactionQuery =
  Native.RpcRequests["getTransactionsByBlock"];
export type RootAddressTransactionQuery =
  Native.RpcRequests["getTransactionsByRootAddress"];
export type StorageItemInfo = Native.RpcStorageItem;
export type StorageItemRead = Native.RpcStorageResult;
export type FundAccountRequest = Native.RpcRequests["dev_fundAccount"];
export type FundAccountResponse = Native.RpcFundingSubmission;
