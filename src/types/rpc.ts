import type { SHA256Hash } from "@groundhogchain/protocol";

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
  status: ExecStatus;
  events: EmittedEvent[];
  returnData: Uint8Array | null;
}

export type ExecStatus =
  | { result: "ok" }
  | { result: "reverted"; message?: string }
  | { result: "deterministicError"; kind: string }
  | { result: "validationFailure"; kind: string }
  | { result: "systemError" };

export interface EmittedEvent {
  contractAddress: SHA256Hash;
  topics: Uint8Array[];
  data: Uint8Array;
}

export interface DevAccount {
  address: SHA256Hash;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  storageTokens: bigint;
}
