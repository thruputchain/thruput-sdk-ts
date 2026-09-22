import type {
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
} from "@groundhogchain/protocol";

/** Execution result enum returned in transaction receipts. */
export type { ExecResult } from "@groundhogchain/protocol";

/** Immutable identity configured for a Groundhog RPC endpoint. */
export interface NetworkInfo {
  /** Protocol network identity bound into every transaction signature. */
  readonly networkHash: NetworkHash;
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
  retryAfterSeconds: number;
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
export interface ViewRequest {
  /** Contract address to invoke. */
  contract: ContractAddress;

  /** Eight-byte contract entrypoint ID. */
  entrypoint: ContractEntrypointID;

  /** Encoded calldata for the entrypoint. */
  calldata: Calldata;

  /** Optional caller address to use for the view. */
  caller?: ContractAddress;
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
}

/** Current gateway knowledge of a submitted transaction. */
export type TransactionStatus =
  | { status: "pending" }
  | { status: "committed"; height: bigint }
  | { status: "invalid"; reason: string }
  | {
      status: "recentFailure";
      attemptHeight: bigint;
      conflict: ConflictDiagnostic;
    }
  | { status: "other" }
  | { status: "unknown" };

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
  /** Matched transaction references in the requested order. */
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

  /** Cursor to pass into the next query for pagination. */
  cursor: Uint8Array;

  /** Latest block visible to the event indexer. */
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
