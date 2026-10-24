import type { Transport, RpcParams, TransportRequestOptions } from "./types.js";
import { codec, deserialize } from "@thruputchain/protocol";
import { toBase58 } from "../encoding.js";
import { fromHex0x } from "../actions/hex.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";

const methods = [
  "getVersionInfo",
  "getNetworkInfo",
  "getChainTip",
  "getChainConfig",
  "getServerLimits",
  "getBalance",
  "getRegisteredAuth",
  "getBlockByHeight",
  "dev_getPendingTransactionCount",
  "simulateInvocation",
  "simulateInvocations",
  "sendTransaction",
  "getTransactionReceipt",
  "getTransactionStatus",
  "getTransactionsByRootAddress",
  "getTransactionsByBlock",
  "getEvents",
  "getStorage",
  "faucet_requestAirdrop",
];
/** Deterministic native RPC transport for examples; it does not execute contract code. */
export class MockTransport implements Transport {
  #height = 0n;
  #transactions = new Map<string, bigint>();
  async request<T = unknown>(
    method: string,
    params: RpcParams = {},
    options?: TransportRequestOptions,
  ): Promise<T> {
    options?.signal?.throwIfAborted();
    if (Array.isArray(params))
      throw new TypeError("Native RPC params must be a named object");
    const stateBlockHeight = this.#height.toString();
    const bounds = {
      oldestIndexedBlockHeight: "0",
      latestIndexedBlockHeight: stateBlockHeight,
      nextCursor: null,
    };
    const simulation = {
      output: { result: "return", returnData: "0x" },
      events: [],
      gasUsed: "0",
    };
    let result: unknown;
    switch (method) {
      case "getVersionInfo":
        result = {
          wireFormat: "14.1.1",
          implementation: "mock",
          supportedMethods: [...methods],
        };
        break;
      case "getNetworkInfo":
        result = { networkHash: "1".repeat(32) };
        break;
      case "getChainTip":
        result = {
          blockHeight: stateBlockHeight,
          blockHash: this.#blockHash(this.#height),
        };
        break;
      case "getChainConfig":
        result = { stated: { maxNewContractsPerTx: 4 } };
        break;
      case "getServerLimits":
        result = {
          maxSimulationGas: "100000000",
          maxSimulationCalldataBytes: "65536",
          maxEventsPerPage: 200,
          maxTransactionsPerPage: 200,
          maxCursorBytes: "1024",
          simulationBatch: {
            maxInvocations: 16,
            maxCalldataBytes: 65536,
            maxGas: "1600000000",
            maxBackendResponseBytes: 1000000,
            timeoutMs: "3000",
          },
        };
        break;
      case "getBalance":
        result = { address: params.address, rawBalance: "0", stateBlockHeight };
        break;
      case "getRegisteredAuth":
        result = {
          address: params.address,
          configuration: null,
          stateBlockHeight,
        };
        break;
      case "getStorage":
        result = { item: null, stateBlockHeight };
        break;
      case "dev_getPendingTransactionCount":
        result = { count: "0" };
        break;
      case "simulateInvocation":
        result = { ...simulation, stateBlockHeight };
        break;
      case "simulateInvocations":
        result = {
          stateBlockHeight,
          results: (params.invocations as unknown[]).map(() =>
            structuredClone(simulation),
          ),
        };
        break;
      case "faucet_requestAirdrop":
        result = {
          attemptStatus: "succeeded",
          recipient: params.recipient,
          rawAmount: "100000000",
          transactionHash: this.#blockHash(this.#height),
          blockHeight: stateBlockHeight,
          execution: { result: "return", returnData: "0x" },
        };
        break;
      case "sendTransaction": {
        const signed = deserialize(
          fromHex0x(String(params.signedTransaction)),
          codec.SignedTransaction,
        );
        const hash = toBase58(hashSignedTransaction(signed));
        if (!this.#transactions.has(hash))
          this.#transactions.set(hash, ++this.#height);
        result = { transactionHash: hash, admission: "accepted" };
        break;
      }
      case "getTransactionReceipt": {
        const height = this.#transactions.get(String(params.transactionHash));
        result =
          height === undefined
            ? null
            : {
                transactionHash: params.transactionHash,
                blockHeight: height.toString(),
                execution: { result: "return", returnData: "0x" },
                events: [],
                gasUsed: "0",
              };
        break;
      }
      case "getTransactionStatus": {
        const height = this.#transactions.get(String(params.transactionHash));
        result =
          height === undefined
            ? { status: "unknown" }
            : { status: "committed", blockHeight: height.toString() };
        break;
      }
      case "getEvents":
        result = { ...bounds, events: [] };
        break;
      case "getTransactionsByRootAddress":
      case "getTransactionsByBlock":
        result = { ...bounds, transactions: [] };
        break;
      case "getBlockByHeight": {
        const height = BigInt(String(params.blockHeight));
        result =
          height <= 0n || height > this.#height
            ? null
            : {
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
                prevBlockHash: this.#blockHash(height - 1n),
                proposalTxsHash: this.#blockHash(height),
                upgrades: [],
              };
        break;
      }
      default:
        throw new Error(`MockTransport: method not implemented: ${method}`);
    }
    return result as T;
  }
  #blockHash(height: bigint): string {
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setBigUint64(24, height);
    return toBase58(bytes);
  }
}
