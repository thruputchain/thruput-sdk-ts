import type {
  SHA256Hash,
  ContractAddress,
  ContractEntrypointID,
  Calldata,
  ExecResult,
} from "@groundhogchain/protocol";

export type { ExecResult } from "@groundhogchain/protocol";

export interface ChainTip {
  height: bigint;
  blockHash: SHA256Hash;
}

export interface VersionInfo {
  wireFormat: string;
  implementation: string;
  commitHash: string | null;
}

export interface ViewRequest {
  contract: ContractAddress;
  entrypoint: ContractEntrypointID;
  calldata: Calldata;
  caller?: ContractAddress;
}

export type ViewOutput =
  | { result: "return"; returnData: Uint8Array }
  | { result: "abort"; abortData: Uint8Array }
  | { result: "fault" };

export interface ViewResponse {
  output: ViewOutput;
  events: EmittedEvent[];
  height: bigint;
}

export type TransactionStatus =
  | { status: "pending" }
  | { status: "committed"; height: bigint }
  | { status: "invalid"; reason: string }
  | { status: "unknown" };

export interface TransactionReceipt {
  txHash: SHA256Hash;
  height: bigint;
  execResult: ExecResult;
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

export interface EmittedEvent {
  contractAddress: ContractAddress;
  topics: Uint8Array[];
  data: Uint8Array;
}

export interface IdentifiedEvent {
  txHash: SHA256Hash;
  blockHeight: bigint;
  sequenceNumber: number;
  event: EmittedEvent;
}

export interface EventPage {
  events: IdentifiedEvent[];
  cursor: Uint8Array;
  latestBlock: bigint;
  oldestBlock: bigint;
}

export interface EventFilter {
  contractAddresses: ContractAddress[];
  topics?: {
    topic0?: Uint8Array[];
    topic1?: Uint8Array[];
    topic2?: Uint8Array[];
  };
}

export type BlockAnchor = "beginning" | "end" | { height: bigint };

export type IterationOrder = "ascending" | "descending";

export interface EventQuery {
  filters: EventFilter[];
  order?: IterationOrder;
  anchor?: BlockAnchor;
  cursor?: Uint8Array;
  limit?: number;
}

export interface DevAccount {
  address: ContractAddress;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  initialStorageTokens: bigint;
}

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

export interface StorageItemRead {
  blockHeight: bigint;
  item: StorageItemInfo | null;
}
