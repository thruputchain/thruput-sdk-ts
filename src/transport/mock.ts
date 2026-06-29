import type { Transport } from "./types.js";
import { sha256Hash, toHex } from "@groundhogchain/protocol";

/**
 * In-memory transport for tests and examples.
 *
 * `MockTransport` implements a small deterministic subset of the Groundhog
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
      case "groundhog_chainTip":
        return this.#chainTip() as T;
      case "groundhog_getBalance":
        return this.#getBalance(params) as T;
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
      case "groundhog_getEvents":
        return this.#getEvents() as T;
      case "groundhog_getStorageAt":
        return this.#getStorageAt() as T;
      default:
        throw new Error(`MockTransport: method not implemented: ${method}`);
    }
  }

  #chainTip(): { height: number; blockHash: string } {
    return {
      height: Number(this.#height),
      blockHash: this.#blockHash(this.#height),
    };
  }

  #blockHash(height: bigint): string {
    const heightBytes = new Uint8Array(32);
    const view = new DataView(heightBytes.buffer);
    view.setBigUint64(24, height > 0n ? height : 0n);
    return "0x" + toHex(sha256Hash(heightBytes));
  }

  #dbHash(height: bigint): string {
    const bytes = new Uint8Array(2048);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(2040, height > 0n ? height : 0n);
    return "0x" + toHex(bytes);
  }

  #getBlockByNumber(params?: unknown[]): {
    networkId: number;
    blockHeight: number;
    txsetHash: string;
    dbHash: string;
    eventsHash: string;
    prevBlockHash: string;
  } | null {
    const height = BigInt(params && params.length > 0 ? String(params[0]) : 0);
    if (height < 0n || height > this.#height) return null;
    return {
      networkId: 0,
      blockHeight: Number(height),
      txsetHash: this.#blockHash(height),
      dbHash: this.#dbHash(height),
      eventsHash: this.#blockHash(height),
      prevBlockHash: this.#blockHash(height > 0n ? height - 1n : 0n),
    };
  }

  #pendingTransactionCount(): number {
    return 0;
  }

  #version(): {
    wireFormat: string;
    implementation: string;
    commitHash: null;
  } {
    return {
      wireFormat: "2.1.0",
      implementation: "mock",
      commitHash: null,
    };
  }

  #getBalance(params?: unknown[]): {
    address: string;
    rawBalance: string;
    height: number;
  } {
    const address = params && params.length > 0 ? String(params[0]) : "0x";
    return {
      address,
      rawBalance: "0",
      height: Number(this.#height),
    };
  }

  #view(): {
    output: { result: "return"; returnData: string };
    events: never[];
    height: number;
  } {
    return {
      output: { result: "return", returnData: "0x" },
      events: [],
      height: Number(this.#height),
    };
  }

  #sendRawTransaction(params?: unknown[]): string {
    const rawTx = params && params.length > 0 ? String(params[0]) : "";
    this.#txCounter++;
    this.#height++;

    const hashInput = new Uint8Array(32);
    const view = new DataView(hashInput.buffer);
    view.setUint32(0, this.#txCounter);
    const hash = "0x" + toHex(sha256Hash(hashInput));

    this.#transactions.set(hash, {
      rawTx,
      height: this.#height,
      hash,
    });

    return hash;
  }

  #getTransactionReceipt(params?: unknown[]): {
    txHash: string;
    height: number;
    status: { result: string };
    events: never[];
    returnData: null;
    abortData: null;
  } | null {
    const txHash = params && params.length > 0 ? String(params[0]) : "";
    const tx = this.#transactions.get(txHash);
    if (!tx) return null;
    return {
      txHash: tx.hash,
      height: Number(tx.height),
      status: { result: "ok" },
      events: [],
      returnData: null,
      abortData: null,
    };
  }

  #getTransactionStatus(params?: unknown[]): {
    status: string;
    height?: number;
  } {
    const txHash = params && params.length > 0 ? String(params[0]) : "";
    const tx = this.#transactions.get(txHash);
    if (!tx) return { status: "unknown" };
    return { status: "committed", height: Number(tx.height) };
  }

  #getEvents() {
    return {
      events: [],
      cursor: "0x",
      latestBlock: Number(this.#height),
      oldestBlock: 0,
    };
  }

  #getStorageAt(): { blockHeight: number; item: null } {
    // The mock has no committed storage state — every key probe returns
    // `item: null` against the current snapshot height.  Tests that need
    // a concrete StorageItemInfo shape should drive the action under a
    // test-local Transport rather than this default mock.
    return {
      blockHeight: Number(this.#height),
      item: null,
    };
  }
}
