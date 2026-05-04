import type {
  SHA256Hash,
  ContractAddress,
  ExecResult,
} from "@groundhogchain/protocol";

export type { ExecResult } from "@groundhogchain/protocol";

export interface ChainTip {
  height: bigint;
  blockHash: SHA256Hash;
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
  returnData: Uint8Array | null;
}

export interface EmittedEvent {
  contractAddress: ContractAddress;
  topics: Uint8Array[];
  data: Uint8Array;
}

export interface DevAccount {
  address: ContractAddress;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  storageTokens: bigint;
}
