import type {
  AuthClaim,
  NetworkHash,
  SHA256Hash,
  BlockHeight,
  ContractAddress,
  ContractEntrypointID,
  Calldata,
  ExecResult,
  Protocol,
  TimePoint,
  ValidatorID,
} from "@thruputchain/protocol";

/** Execution result enum returned in transaction receipts. */
export type { ExecResult } from "@thruputchain/protocol";

/** A registered authorization key, including schemes unknown to the server. */
export type AuthPublicKey =
  | { readonly scheme: "ed25519"; readonly key: Uint8Array }
  | { readonly scheme: "unknown"; readonly schemeId: number };

/** An occupied authorization key slot and its weight. */
export interface AuthSigner {
  readonly keyId: number;
  readonly publicKey: AuthPublicKey;
  readonly maxWeight: number;
}

/** Registered signer slots and the weight required to authorize a transaction. */
export interface AddressAuthDataInfo {
  readonly signers: readonly AuthSigner[];
  readonly requiredWeight: number;
}

/** Authorization configuration at a committed height; null means unregistered. */
export interface AddressAuthDataResponse {
  readonly address: ContractAddress;
  readonly height: bigint;
  readonly authData: AddressAuthDataInfo | null;
}

/** Immutable identity configured for a Thruput RPC endpoint. */
export interface NetworkInfo {
  /** Protocol network identity bound into every transaction signature. */
  readonly networkHash: NetworkHash;
}

/**
 * Execution limits reported by the network.
 *
 * In stated configuration, `null` means the chain did not state the parameter.
 * In {@link ExecutionConfig.effectiveLimits}, `null` means the effective value
 * is unavailable. Neither means zero.
 */
export interface NetworkConfigParams {
  /** Levels of node nesting an auth token may carry. */
  readonly maxAuthTokenDepth: number | null;

  /** Bytes one bytestring storage item may hold. */
  readonly maxBytestringLen: number | null;

  /** Bytes one attached contract's code blob may hold. */
  readonly maxContractSizeBytes: number | null;

  /** Invocation frames one transaction may have open at once. */
  readonly maxCrossInvokeDepth: number | null;

  /** Contracts one transaction may attach in `contractsToDeploy`. */
  readonly maxNewContractsPerTx: number | null;

  /** Code bytes an RV32 artifact may carry to be attached. */
  readonly maxRv32CodeBytes: number | null;

  /** Guest data memory bytes an RV32 artifact may declare to be attached. */
  readonly maxRv32MemoryBytes: number | null;

  /** Storage savepoints one transaction may have open at once. */
  readonly maxSavepointDepth: number | null;

  /** Concurrently open incremental SHA-256 buffers per invocation frame. */
  readonly maxSha256Buffers: number | null;
}

/** Stated configuration and optional authoritative execution rules. */
export interface ChainConfig extends NetworkConfigParams {
  /** Rules fetched during the request; absent when the backend lacks this capability. */
  readonly execution?: ExecutionConfig;
}

/** Rules for execution following the observed tip, not guaranteed at later inclusion. */
export interface ExecutionConfig {
  /** Committed snapshot read together with the limits and prices. */
  readonly observedTip: ChainTip;
  /** Commitment to the stated chain configuration, including storage prices. */
  readonly configHash: SHA256Hash;
  /** Runtime-resolved limits; `null` means unavailable, never zero. */
  readonly effectiveLimits: NetworkConfigParams;
  readonly storageCosts: StorageCosts;
}

/** Storage collateral in native HOG base units (10,000,000 per HOG), not gas prices. */
export interface StorageCosts {
  /** Base collateral for an ordinary data item; balance and code use separate bases. */
  readonly baseDataItemCost: bigint;
  /** Added to the ordinary base for each byte in a bytestring value. */
  readonly bytestringCostPerByte: bigint;
  /** RV32 code-storage base, excluding the address's balance deposit. */
  readonly baseContractDeploymentCost: bigint;
  /** Added per byte of the full deployed artifact. */
  readonly contractDeploymentCostPerByte: bigint;
  /** Added to the ordinary base for each authorization key. */
  readonly authPerKeyCost: bigint;
  /** Added to the ordinary base per live queue entry; an empty queue costs zero. */
  readonly rcqCostPerEntry: bigint;
  /** Added to the ordinary base per replay-cache entry, charged to its owner. */
  readonly replayCacheCostPerEntry: bigint;
  /** Deposit deducted from the first credit to a new balance item. */
  readonly balanceCost: bigint;
}

/** Endpoint policy for a shared-snapshot group; per-call view limits also apply. */
export interface ViewBatchLimits {
  readonly maxCalls: number;
  readonly maxCalldataBytes: number;
  /** Sum of declared gas limits per attempt. */
  readonly maxGas: bigint;
  /** Encoded backend result including events, before JSON encoding. */
  readonly maxResponseBytes: number;
  /** Upper bound on response wait, not a guarantee that backend work stops. */
  readonly timeoutMs: bigint;
}

/** Endpoint request bounds, which may vary between servers on the same chain. */
export interface ServerLimits {
  /** Absent when the endpoint does not advertise batch limits. */
  readonly viewBatch?: ViewBatchLimits;
  /** Maximum view gas, also used when a view omits its gas limit. */
  readonly maxViewGas: bigint;
  /** Maximum view calldata size in bytes. */
  readonly maxViewCalldataBytes: bigint;
  /** Maximum events requested in one page. */
  readonly maxEventsPerPage: number;
  /** Maximum transactions requested in one address-history page. */
  readonly maxTransactionsPerPage: number;
  /** Maximum opaque cursor size in bytes. */
  readonly maxCursorBytes: bigint;
}

/** One idempotent airdrop attempt. */
export interface AirdropAttemptRequest {
  /** Address to fund. */
  recipient: ContractAddress;

  /** Caller-generated 1-32 byte idempotency key. */
  clientNonce: Uint8Array;
}

/** Structured execution status reported by the gateway. */
export type ExecutionStatus =
  | { result: "ok" }
  | { result: "reverted"; message?: string | null }
  | { result: "deterministicError"; kind: string }
  | { result: "nonDeterministicError" }
  | { result: "failedGasSponsorship" }
  | { result: "other" };

/** Execution status attached to a committed airdrop transaction. */
export type AirdropExecutionStatus = ExecutionStatus;

/** Airdrop attempt accepted but not yet committed. */
export interface AirdropPending {
  attemptStatus: "pending";
  recipient: ContractAddress;
  rawAmount: bigint;
  txHash?: SHA256Hash;
  retryAfterSeconds: bigint;
}

/** Airdrop transaction committed to the network. */
export interface AirdropSucceeded {
  attemptStatus: "succeeded";
  recipient: ContractAddress;
  rawAmount: bigint;
  txHash: SHA256Hash;
  height: bigint;
  status: AirdropExecutionStatus;
}

/** Tagged result of one airdrop attempt request. */
export type AirdropResponse = AirdropPending | AirdropSucceeded;

/** Latest chain tip reported by the JSON-RPC gateway. */
export interface ChainTip {
  /** Latest block height known to the gateway. */
  height: bigint;

  /** Hash of the latest block known to the gateway. */
  blockHash: SHA256Hash;
}

/** HOG balance response for a contract address. */
export interface BalanceResponse {
  /** Address whose balance was read. */
  address: ContractAddress;

  /** Balance in raw protocol units. */
  rawBalance: bigint;

  /** Block height of the snapshot used for the read. */
  height: bigint;
}

/** Block metadata returned by height lookups. */
export interface BlockInfo {
  /** Canonical hash of the complete consensus value. */
  blockHash: SHA256Hash;

  /** Protocol version selected for the block. */
  protocol: Protocol;

  /** Signing network the block belongs to. */
  networkHash: NetworkHash;

  /** Validator that proposed the block. */
  proposer: ValidatorID;

  /** Unix timestamp in nanoseconds. */
  blockTimepoint: TimePoint;

  /** Height of the returned block. */
  blockHeight: BlockHeight;

  /** Hash of the block's transactions. */
  txsHash: SHA256Hash;

  /** Hash of committed storage after the block. */
  storageHash: SHA256Hash;

  /** Event accumulator hash for the block. */
  eventsHash: SHA256Hash;

  /** Hash of the post-block network configuration committed by consensus. */
  configHash: SHA256Hash;

  /** Previous block hash. */
  prevBlockHash: SHA256Hash;

  /** Hash of the transactions selected by the proposal. */
  proposalTxsHash: SHA256Hash;

  /** Opaque protocol upgrades selected by consensus. */
  upgrades: Uint8Array[];
}

/** Gateway implementation and wire-format version information. */
export interface VersionInfo {
  /** Public JSON-RPC wire-format version. */
  wireFormat: string;

  /** Gateway implementation identifier. */
  implementation: string;

  /** Gateway commit hash when the implementation reports one. */
  commitHash: string | null;

  /** Platform release this implementation was packaged for, when reported. */
  platformVersion: string | null;

  /** Validated bundle release, when reported. Diagnostic-only; not a capability flag. */
  releaseVersion: string | null;

  /** Validated bundle manifest digest, when reported. Diagnostic-only. */
  bundleManifestDigest: string | null;
}

/** Request for a read-only contract invocation. */
export interface ViewCall {
  /** Optional assumed authorization. Signatures are not verified; writes never commit. */
  authClaim?: AuthClaim;
  /** Contract address to invoke. */
  contract: ContractAddress;

  /** Eight-byte contract entrypoint ID. */
  entrypoint: ContractEntrypointID;

  /** Encoded calldata for the entrypoint. */
  calldata: Calldata;

  /** Optional caller address to use for the view. */
  caller?: ContractAddress;

  /** Positive u64 gas budget; omitted uses the endpoint's maxViewGas. */
  gasLimit?: bigint;
}

/** A single simulation with an optional minimum committed snapshot height. */
export interface ViewRequest extends ViewCall {
  /** Freshness floor only. Does not wait or force a snapshot refresh. */
  minHeight?: bigint;
}

/** Independent calls evaluated against one committed snapshot. */
export interface ViewBatchRequest {
  /** Nonempty group bounded by the endpoint's advertised limits. */
  calls: readonly (ViewCall & { minHeight?: never })[];
  /** Freshness floor on the snapshot. Does not wait or request a refresh. */
  minHeight?: bigint;
}

/** Ordered outputs and events with the group's committed snapshot height. */
export interface ViewBatchResponse {
  height: bigint;
  results: Omit<ViewResponse, "height">[];
}

/** Tagged output from a read-only contract invocation. */
export type ViewOutput =
  | { result: "return"; returnData: Uint8Array }
  | { result: "abort"; abortData: Uint8Array }
  | { result: "fault" };

/** Response from a read-only contract invocation. */
export interface ViewResponse {
  /** Invocation output variant. */
  output: ViewOutput;

  /** Events emitted while evaluating the view. */
  events: EmittedEvent[];

  /** Block height of the snapshot used for the view. */
  height: bigint;

  /** Gas consumed by the root and nested frames; equals the budget on out-of-gas. */
  gasUsed: bigint;
}

/** Current gateway knowledge of a submitted transaction. */
export type TransactionStatus =
  | { status: "pending" }
  | {
      status: "committed";
      /** Available when the indexer has recorded the commitment height. */
      height?: bigint;
    }
  | { status: "retry"; error: SchedulerTransactionError }
  | { status: "dropped"; error: SchedulerTransactionError }
  | { status: "invalid"; reason: string }
  | {
      status: "recentFailure";
      attemptHeight: bigint;
      /** Advisory attempt failure; does not establish a terminal outcome. */
      cause: TransactionFailureCause;
    }
  | { status: "other" }
  | { status: "unknown" };

/** Scheduler processing failure; the source identifies the protocol enum of code. */
export interface SchedulerTransactionError {
  /** AuthErrorCode, SchedulerErrorCode, or ExecResult supplies the signed i32 code. */
  source: "auth" | "scheduler" | "executor" | "other";
  code: number;
}

/** Cause of a recent failed attempt; the transaction may still commit later. */
export type TransactionFailureCause =
  | { kind: "dbConflict"; conflict: ConflictDiagnostic }
  | {
      kind: "contractRejected";
      /** Zero-based index in the transaction's new-contract list. */
      contractIndex: number;
      code: ContractRejectCode;
    }
  | { kind: "other" };

/** Coarse reason a new contract was rejected during a recent attempt. */
export type ContractRejectCode =
  | "tooMany"
  | "blobTooLarge"
  | "notDeployable"
  | "duplicate"
  | "malformedArtifact"
  | "unsupportedFormat"
  | "unsupportedAbi"
  | "gasScheduleMismatch"
  | "memoryTooLarge"
  | "codeSizeInvalid"
  | "initialMemoryInvalid"
  | "digestMismatch"
  | "invalidProgram"
  | "other";

/** Coarse reason a storage operation conflicted during two-phase commit. */
export type ConflictCode =
  | "exclusiveLock"
  | "typeMismatch"
  | "valueMismatch"
  | "boundsExceeded"
  | "overflow"
  | "replayProtection"
  | "queueConsumer"
  | "capacityExceeded"
  | "insufficientFunds"
  | "other";

/** First conflicting storage operation reported for a recent failed attempt. */
export interface ConflictDiagnostic {
  /** Contract whose storage the conflicting operation targeted. */
  address: ContractAddress;

  /** XDR-encoded storage key bytes. */
  key: Uint8Array;

  /** Coarse conflict reason. */
  code: ConflictCode;
}

/** Lightweight reference to a committed transaction. */
export interface TransactionRef {
  /** Transaction hash. */
  txHash: SHA256Hash;

  /** Block height where the transaction executed. */
  height: bigint;
}

/** One page of transaction-history references. */
export interface TransactionRefPage {
  /** Matched references in the walk's order. Block continuations retain the
   * cursor's original order, even when the request specifies a different order. */
  refs: TransactionRef[];

  /** Cursor to pass into the next query for pagination. */
  cursor: Uint8Array;

  /** Latest block visible to the transaction indexer. */
  latestBlock: bigint;

  /** Oldest block retained by the transaction indexer. */
  oldestBlock: bigint;
}

/** Committed transaction receipt. */
export interface TransactionReceipt {
  /** Structured gateway execution status, including available fault/revert diagnostics. */
  executionStatus?: ExecutionStatus;
  /** Transaction hash. */
  txHash: SHA256Hash;

  /** Block height where the transaction committed. */
  height: bigint;

  /** Protocol execution result. */
  execResult: ExecResult;

  /** Events emitted by the transaction. */
  events: EmittedEvent[];

  /** Bytes returned by the contract on success, or `null` for any
   *  other outcome and for older receipts that pre-date return-data
   *  recording. */
  returnData: Uint8Array | null;

  /** Bytes passed to `abort` / `revert` by a deterministically-
   *  reverted contract, or `null` for any other outcome and for
   *  older receipts that pre-date revert-data recording. */
  abortData: Uint8Array | null;

  /** Gas the transaction consumed: the root frame, every frame it
   *  invoked, and the pre-execution validation of attached contracts.
   *  Equals the transaction's gas limit on an out-of-gas fault. The
   *  figure is committed by consensus in the transaction's event log,
   *  so every node reports the same value. */
  gasUsed: bigint;
}

/** Event emitted by a contract invocation. */
export interface EmittedEvent {
  /** Contract address that emitted the event. */
  contractAddress: ContractAddress;

  /** Indexed event topics. Topic 0 is usually the event signature. */
  topics: Uint8Array[];

  /** Event payload bytes. */
  data: Uint8Array;
}

/** Event plus block and transaction identity. */
export interface IdentifiedEvent {
  /** Transaction hash that emitted the event. */
  txHash: SHA256Hash;

  /** Block height containing the event. */
  blockHeight: bigint;

  /** Event sequence number within the indexed stream. */
  sequenceNumber: number;

  /** Emitted event payload and topics. */
  event: EmittedEvent;
}

/** One page of event query results. */
export interface EventPage {
  /** Events in this page. */
  events: IdentifiedEvent[];

  /** Continuation cursor. Empty means exhausted; an empty event list alone does not. */
  cursor: Uint8Array;

  /** Latest block visible to the event indexer, not proof that this page covers that height. */
  latestBlock: bigint;

  /** Oldest block retained by the event indexer. */
  oldestBlock: bigint;
}

/** Filter for events emitted by one or more contracts and optional topics. */
export interface EventFilter {
  /** Contract addresses to include in the filter. */
  contractAddresses: ContractAddress[];

  /** Optional topic filters by indexed topic position. */
  topics?: {
    /** Accepted values for topic 0. */
    topic0?: Uint8Array[];

    /** Accepted values for topic 1. */
    topic1?: Uint8Array[];

    /** Accepted values for topic 2. */
    topic2?: Uint8Array[];
  };
}

/** Event query anchor position. */
export type BlockAnchor = "beginning" | "end" | { height: bigint };

/** Event query ordering. */
export type IterationOrder = "ascending" | "descending";

/** Paginated event query. */
export interface EventQuery {
  /** Event filters to apply. */
  filters: EventFilter[];

  /** Result ordering. Defaults to ascending. */
  order?: IterationOrder;

  /** Block position to start from. Defaults to the beginning. */
  anchor?: BlockAnchor;

  /** Cursor returned by a previous page. */
  cursor?: Uint8Array;

  /** Maximum number of events to return. */
  limit?: number;
}

/** Paginated hash-ordered transaction references from one committed block. */
export interface BlockTransactionQuery {
  /** Exact committed height. Non-negative int64, kept as bigint. */
  height: bigint;
  /** Unsigned hash order, not execution order. Defaults to ascending. */
  order?: IterationOrder;
  /** Opaque continuation. Keep the same height; the cursor retains its order. */
  cursor?: Uint8Array;
  /** Positive page size, at most 200 and subject to endpoint limits. Defaults to 50. */
  limit?: number;
}

/** Paginated transaction-history query for transactions rooted at one address. */
export interface AddressTransactionQuery {
  /** Contract address whose transaction history should be queried. */
  address: ContractAddress;

  /** Result ordering. Defaults to ascending. */
  order?: IterationOrder;

  /** Block position to start from. Defaults to the beginning. */
  anchor?: BlockAnchor;

  /** Cursor returned by a previous page. */
  cursor?: Uint8Array;

  /** Maximum number of refs to return. */
  limit?: number;
}

/** Typed storage item returned by the gateway. */
export type StorageItemInfo =
  | { kind: "nonnegativeInt"; value: bigint }
  | { kind: "bytestring"; bytes: Uint8Array }
  | { kind: "authData" }
  | { kind: "retrocausalQueue" }
  | { kind: "replayCacheEntry" }
  | {
      kind: "deployedContract";
      hash: SHA256Hash;
      size: number;
      contractType: number;
    }
  | { kind: "unknown"; typeId: number };

/** Storage read result for one address/key pair. */
export interface StorageItemRead {
  /** Block height of the snapshot used for the read. */
  blockHeight: bigint;

  /** Storage item at the key, or `null` when the key is absent. */
  item: StorageItemInfo | null;
}

/** Explicit amount-bound request for a local supervisor's funding service. */
export interface FundAccountRequest {
  readonly recipient: ContractAddress;
  readonly rawAmount: bigint;
  /** Caller-owned 1-32 byte idempotency nonce. Persist before sending. */
  readonly clientNonce: Uint8Array;
  /** Public faucet address from the local schema-4 manifest, identifying the chain. */
  readonly faucet: ContractAddress;
}
/** Admission response. The exact signed bytes remain valid for manual block production. */
export interface FundAccountResponse {
  readonly recipient: ContractAddress;
  readonly rawAmount: bigint;
  readonly txHash: SHA256Hash;
  readonly signedTransaction: Uint8Array;
}
