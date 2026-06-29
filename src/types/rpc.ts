import type {
  SHA256Hash,
  DbHash,
  ContractAddress,
  ContractEntrypointID,
  Calldata,
  ExecResult,
} from "@groundhogchain/protocol";

/** Execution result enum returned in transaction receipts. */
export type { ExecResult } from "@groundhogchain/protocol";

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
  /** Network identifier for the block. */
  networkId: bigint;

  /** Height of the returned block. */
  blockHeight: bigint;

  /** Transaction-set hash for the block. */
  txsetHash: SHA256Hash;

  /** Database state hash for the block. */
  dbHash: DbHash;

  /** Event accumulator hash for the block. */
  eventsHash: SHA256Hash;

  /** Previous block hash. */
  prevBlockHash: SHA256Hash;
}

/** Gateway implementation and wire-format version information. */
export interface VersionInfo {
  /** Public JSON-RPC wire-format version. */
  wireFormat: string;

  /** Gateway implementation identifier. */
  implementation: string;

  /** Gateway commit hash when the implementation reports one. */
  commitHash: string | null;
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
  | { status: "unknown" };

/** Committed transaction receipt. */
export interface TransactionReceipt {
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
