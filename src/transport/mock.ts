import type { Transport } from "./types.js";
import { sha256Hash } from "@thruputchain/protocol";
import { toBase58 } from "../encoding.js";
import { parseHeight } from "../actions/decimal.js";

/**
 * In-memory transport for tests and examples.
 *
 * `MockTransport` implements a small deterministic subset of the Thruput
 * JSON-RPC API. It is useful for SDK unit tests and simple examples, but it is
 * not a full node simulator and does not execute contract code.
 */
export class MockTransport implements Transport {
  #height = 0n;
  #transactions = new Map<
    string,
    { rawTx: string; height: bigint; hash: string }
  >();
  #txCounter = 0;

  /** Route a supported JSON-RPC method to the mock implementation. */
  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    switch (method) {
      case "groundhog_networkInfo":
        return this.#networkInfo() as T;
      case "groundhog_serverLimits":
        return {
          maxViewGas: "100000000",
          maxViewCalldataBytes: "65536",
          maxEventsPerPage: 200,
          maxTransactionsPerPage: 200,
          maxCursorBytes: "1024",
        } as T;
      case "groundhog_chainConfig":
        return this.#chainConfig() as T;
      case "groundhog_requestAirdrop":
        return this.#requestAirdrop(params) as T;
      case "groundhog_chainTip":
        return this.#chainTip() as T;
      case "groundhog_getBalance":
        return this.#getBalance(params) as T;
      case "groundhog_getAddressAuthData":
        return {
          address: String(params?.[0]),
          height: this.#height.toString(),
          authData: null,
        } as T;
      case "groundhog_getBlockByNumber":
        return this.#getBlockByNumber(params) as T;
      case "groundhog_pendingTransactionCount":
        return this.#pendingTransactionCount() as T;
      case "groundhog_version":
        return this.#version() as T;
      case "groundhog_view":
        return this.#view() as T;
      case "groundhog_sendRawTransaction":
        return this.#sendRawTransaction(params) as T;
      case "groundhog_getTransactionReceipt":
        return this.#getTransactionReceipt(params) as T;
      case "groundhog_getTransactionStatus":
        return this.#getTransactionStatus(params) as T;
      case "groundhog_getTransactionsByAddress":
        return this.#getTransactionsByAddress() as T;
      case "groundhog_getEvents":
        return this.#getEvents() as T;
      case "groundhog_getStorageAt":
        return this.#getStorageAt() as T;
      default:
        throw new Error(`MockTransport: method not implemented: ${method}`);
    }
  }

  #networkInfo(): { networkHash: string } {
    return {
      networkHash: "1".repeat(32),
    };
  }

  #chainConfig(): Record<string, number> {
    return { maxNewContractsPerTx: 4 };
  }

  #requestAirdrop(params?: unknown[]): {
    attemptStatus: "succeeded";
    recipient: string;
    rawAmount: string;
    txHash: string;
    height: string;
    status: { result: "ok" };
  } {
    const request = (params?.[0] ?? {}) as { recipient?: unknown };
    return {
      attemptStatus: "succeeded",
      recipient: String(request.recipient ?? "0x"),
      rawAmount: "100000000",
      txHash: this.#blockHash(this.#height),
      height: this.#height.toString(),
      status: { result: "ok" },
    };
  }

  #chainTip(): { height: string; blockHash: string } {
    return {
      height: this.#height.toString(),
      blockHash: this.#blockHash(this.#height),
    };
  }

  #blockHash(height: bigint): string {
    const heightBytes = new Uint8Array(32);
    const view = new DataView(heightBytes.buffer);
    view.setBigUint64(24, height > 0n ? height : 0n);
    return toBase58(sha256Hash(heightBytes));
  }

  #getBlockByNumber(params?: unknown[]): {
    blockHash: string;
    protocol: number;
    networkHash: string;
    proposer: string;
    blockTimepoint: string;
    blockHeight: string;
    txsHash: string;
    storageHash: string;
    eventsHash: string;
    configHash: string;
    prevBlockHash: string;
    proposalTxsHash: string;
    upgrades: string[];
  } | null {
    const height = parseHeight(params?.[0]);
    if (height < 0n || height > this.#height) return null;
    return {
      blockHash: this.#blockHash(height),
      protocol: 0,
      networkHash: "1".repeat(32),
      proposer: "1".repeat(32),
      blockTimepoint: "0",
      blockHeight: height.toString(),
      txsHash: this.#blockHash(height),
      storageHash: this.#blockHash(height),
      eventsHash: this.#blockHash(height),
      configHash: this.#blockHash(height),
      prevBlockHash: this.#blockHash(height > 0n ? height - 1n : 0n),
      proposalTxsHash: this.#blockHash(height),
      upgrades: [],
    };
  }

  #pendingTransactionCount(): string {
    return "0";
  }

  #version(): {
    wireFormat: string;
    implementation: string;
    commitHash: null;
    platformVersion: null;
  } {
    return {
      wireFormat: "9.0.0",
      implementation: "mock",
      commitHash: null,
      platformVersion: null,
    };
  }

  #getBalance(params?: unknown[]): {
    address: string;
    rawBalance: string;
    height: string;
  } {
    const address = params && params.length > 0 ? String(params[0]) : "0x";
    return {
      address,
      rawBalance: "0",
      height: this.#height.toString(),
    };
  }

  #view(): {
    output: { result: "return"; returnData: string };
    events: never[];
    height: string;
    gasUsed: string;
  } {
    return {
      output: { result: "return", returnData: "0x" },
      events: [],
      height: this.#height.toString(),
      gasUsed: "0",
    };
  }

  #sendRawTransaction(params?: unknown[]): string {
    const rawTx = params && params.length > 0 ? String(params[0]) : "";
    this.#txCounter++;
    this.#height++;

    const hashInput = new Uint8Array(32);
    const view = new DataView(hashInput.buffer);
    view.setUint32(0, this.#txCounter);
    const hash = toBase58(sha256Hash(hashInput));

    this.#transactions.set(hash, {
      rawTx,
      height: this.#height,
      hash,
    });

    return hash;
  }

  #getTransactionReceipt(params?: unknown[]): {
    txHash: string;
    height: string;
    status: { result: string };
    events: never[];
    returnData: null;
    abortData: null;
    gasUsed: string;
  } | null {
    const txHash = params && params.length > 0 ? String(params[0]) : "";
    const tx = this.#transactions.get(txHash);
    if (!tx) return null;
    return {
      txHash: tx.hash,
      height: tx.height.toString(),
      status: { result: "ok" },
      events: [],
      returnData: null,
      abortData: null,
      gasUsed: "0",
    };
  }

  #getTransactionStatus(params?: unknown[]): {
    status: string;
    height?: string;
  } {
    const txHash = params && params.length > 0 ? String(params[0]) : "";
    const tx = this.#transactions.get(txHash);
    if (!tx) return { status: "unknown" };
    return { status: "committed", height: tx.height.toString() };
  }

  #getTransactionsByAddress() {
    return {
      refs: [],
      cursor: "0x",
      latestBlock: this.#height.toString(),
      oldestBlock: "0",
    };
  }

  #getEvents() {
    return {
      events: [],
      cursor: "0x",
      latestBlock: this.#height.toString(),
      oldestBlock: "0",
    };
  }

  #getStorageAt(): { blockHeight: string; item: null } {
    // The mock has no committed storage state — every key probe returns
    // `item: null` against the current snapshot height.  Tests that need
    // a concrete StorageItemInfo shape should drive the action under a
    // test-local Transport rather than this default mock.
    return {
      blockHeight: this.#height.toString(),
      item: null,
    };
  }
}
