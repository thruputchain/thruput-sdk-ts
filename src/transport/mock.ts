import type { Transport } from "./types.js";
import { sha256Hash, toHex, fromHex } from "@groundhogchain/protocol";

export class MockTransport implements Transport {
  #height = 0n;
  #transactions = new Map<
    string,
    { rawTx: string; height: bigint; hash: string }
  >();
  #txCounter = 0;

  async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    switch (method) {
      case "groundhog_chainTip":
        return this.#chainTip() as T;
      case "groundhog_sendRawTransaction":
        return this.#sendRawTransaction(params) as T;
      case "groundhog_getTransactionReceipt":
        return this.#getTransactionReceipt(params) as T;
      case "groundhog_getTransactionStatus":
        return this.#getTransactionStatus(params) as T;
      case "groundhog_dev_reset":
        return this.#devReset() as T;
      case "groundhog_dev_getAccounts":
        return this.#devGetAccounts() as T;
      default:
        throw new Error(`MockTransport: method not implemented: ${method}`);
    }
  }

  #chainTip(): { height: string; blockHash: string } {
    const heightBytes = new Uint8Array(32);
    const view = new DataView(heightBytes.buffer);
    view.setBigUint64(24, this.#height > 0n ? this.#height : 0n);
    return {
      height: "0x" + this.#height.toString(16),
      blockHash: "0x" + toHex(sha256Hash(heightBytes)),
    };
  }

  #sendRawTransaction(
    params?: unknown[],
  ): { txHash: string } {
    const rawTx =
      params && params.length > 0 ? String(params[0]) : "";
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

    return { txHash: hash };
  }

  #getTransactionReceipt(params?: unknown[]): {
    txHash: string;
    height: string;
    status: { result: string };
    events: never[];
    returnData: null;
  } | null {
    const txHash =
      params && params.length > 0 ? String(params[0]) : "";
    const tx = this.#transactions.get(txHash);
    if (!tx) return null;
    return {
      txHash: tx.hash,
      height: "0x" + tx.height.toString(16),
      status: { result: "ok" },
      events: [],
      returnData: null,
    };
  }

  #getTransactionStatus(params?: unknown[]): {
    status: string;
    height?: string;
  } {
    const txHash =
      params && params.length > 0 ? String(params[0]) : "";
    const tx = this.#transactions.get(txHash);
    if (!tx) return { status: "unknown" };
    return { status: "committed", height: "0x" + tx.height.toString(16) };
  }

  #devReset(): { success: boolean } {
    this.#height = 0n;
    this.#transactions.clear();
    this.#txCounter = 0;
    return { success: true };
  }

  #devGetAccounts(): {
    address: string;
    publicKey: string;
    privateKey: string;
    storageTokens: string;
  }[] {
    const accounts = [];
    for (let i = 0; i < 3; i++) {
      const seed = new Uint8Array(32);
      seed[0] = i;
      const addressBytes = sha256Hash(seed);

      const pubSeed = new Uint8Array(32);
      pubSeed[0] = i;
      pubSeed[31] = 1;

      const privSeed = new Uint8Array(32);
      privSeed[0] = i;
      privSeed[31] = 2;

      accounts.push({
        address: "0x" + toHex(addressBytes),
        publicKey: "0x" + toHex(pubSeed),
        privateKey: "0x" + toHex(privSeed),
        storageTokens: "0x" + (1000000n).toString(16),
      });
    }
    return accounts;
  }
}
