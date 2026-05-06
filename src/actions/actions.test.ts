import { describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  calldata,
  contractEntrypointID,
  AuthClaimType,
  bitMap,
  weight,
  ExecResult,
} from "@groundhogchain/protocol";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createInvocation, createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import { MockTransport } from "../transport/mock.js";
import { sendTransaction } from "./wallet/sendTransaction.js";
import { getChainTip } from "./public/getChainTip.js";
import { getTransactionReceipt } from "./public/getTransactionReceipt.js";
import { getTransactionStatus } from "./public/getTransactionStatus.js";
import { getEvents } from "./public/getEvents.js";
import { getStorageAt } from "./public/getStorageAt.js";
import { devReset, devGetAccounts } from "./dev/index.js";
import type { Transport } from "../transport/types.js";

function makeDummySignedTx() {
  const secretKey = new Uint8Array(32);
  secretKey[0] = 1;
  const signer = new PrivateKeySigner(secretKey);

  const invocation = createInvocation({
    invoked_address: contractAddress(new Uint8Array(32)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3, 4])),
  });

  const tx = createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(100n),
      nonce: 42n,
    },
    contracts_to_deploy: [],
    auth_claim: {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(0xffffffffn),
        required_weight: weight(1n),
      },
    },
  });

  return signTransaction(tx, [{ signer, publicKeyId: 0n }]);
}

describe("sendTransaction", () => {
  it("sends a signed tx and returns a 32-byte hash", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const hash = await sendTransaction(transport, signedTx);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });
});

describe("getChainTip", () => {
  it("returns height 0n and 32-byte blockHash on empty mock", async () => {
    const transport = new MockTransport();
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(0n);
    expect(tip.blockHash).toBeInstanceOf(Uint8Array);
    expect(tip.blockHash.length).toBe(32);
  });

  it("reflects height 1n after sending a transaction", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(1n);
  });
});

describe("getTransactionReceipt", () => {
  it("returns receipt for submitted tx", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const txHash = await sendTransaction(transport, signedTx);
    const receipt = await getTransactionReceipt(transport, txHash);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toEqual(txHash);
    expect(receipt!.execResult).toBe(ExecResult.ExecResultOK);
    expect(receipt!.events).toEqual([]);
  });

  it("returns null for unknown tx", async () => {
    const transport = new MockTransport();
    const fakeHash = new Uint8Array(32) as any;
    const receipt = await getTransactionReceipt(transport, fakeHash);
    expect(receipt).toBeNull();
  });
});

describe("getTransactionStatus", () => {
  it("returns committed for submitted tx", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const txHash = await sendTransaction(transport, signedTx);
    const status = await getTransactionStatus(transport, txHash);
    expect(status.status).toBe("committed");
  });

  it("returns unknown for missing tx", async () => {
    const transport = new MockTransport();
    const fakeHash = new Uint8Array(32) as any;
    const status = await getTransactionStatus(transport, fakeHash);
    expect(status.status).toBe("unknown");
  });
});

describe("getEvents", () => {
  it("returns empty event page from mock", async () => {
    const transport = new MockTransport();
    const page = await getEvents(transport, {
      filters: [
        {
          contractAddresses: [contractAddress(new Uint8Array(32).fill(0x11))],
        },
      ],
    });
    expect(page.events).toEqual([]);
    expect(page.latestBlock).toBe(0n);
    expect(page.oldestBlock).toBe(0n);
    expect(page.cursor.length).toBe(0);
  });

  it("latestBlock reflects chain height", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);

    const page = await getEvents(transport, {
      filters: [
        {
          contractAddresses: [contractAddress(new Uint8Array(32).fill(0x11))],
        },
      ],
    });
    expect(page.latestBlock).toBe(1n);
  });

  it("serializes query with bare hex (no 0x prefix) for XDR-derived fields", async () => {
    const calls: { method: string; params?: unknown[] }[] = [];
    const spyTransport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        return {
          events: [],
          cursor: "",
          latestBlock: 0,
          oldestBlock: 0,
        } as T;
      },
    };

    const addr = contractAddress(new Uint8Array(32).fill(0xab));
    const topic = new Uint8Array(32).fill(0xcd);

    await getEvents(spyTransport, {
      filters: [
        {
          contractAddresses: [addr],
          topics: { topic0: [topic] },
        },
      ],
      order: "descending",
      anchor: { height: 42n },
      limit: 10,
    });

    expect(calls).toHaveLength(1);
    const query = (calls[0].params as any[])[0];

    // Contract addresses: bare hex, no 0x
    expect(query.filters[0].contract_addresses[0]).toBe("ab".repeat(32));
    expect(query.filters[0].contract_addresses[0]).not.toContain("0x");

    // Topics: bare hex, no 0x
    expect(query.filters[0].topics.topic0[0]).toBe("cd".repeat(32));
    expect(query.filters[0].topics.topic0[0]).not.toContain("0x");

    // Cursor: bare empty string
    expect(query.cursor).toBe("");

    // Order: 1 for descending
    expect(query.order).toBe(1);

    // Anchor: AnchorAtHeight
    expect(query.anchor).toEqual({ AnchorAtHeight: { height: 42 } });

    // Limit
    expect(query.limit).toBe(10);
  });
});

describe("devReset", () => {
  it("clears state so chainTip height returns to 0n", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);
    const tipBefore = await getChainTip(transport);
    expect(tipBefore.height).toBe(1n);

    await devReset(transport);
    const tipAfter = await getChainTip(transport);
    expect(tipAfter.height).toBe(0n);
  });
});

describe("devGetAccounts", () => {
  it("returns typed accounts with correct field lengths", async () => {
    const transport = new MockTransport();
    const accounts = await devGetAccounts(transport);
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.address.length).toBe(32);
      expect(account.publicKey.length).toBeGreaterThan(0);
    }
  });
});

describe("getStorageAt", () => {
  it("rejects a non-32-byte key before issuing a request", async () => {
    const transport = new MockTransport();
    await expect(
      getStorageAt(
        transport,
        contractAddress(new Uint8Array(32)),
        new Uint8Array(16),
      ),
    ).rejects.toThrow(/32 bytes/);
  });

  it("returns blockHeight and a null item for an unwritten key on the mock", async () => {
    const transport = new MockTransport();
    const read = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(read.blockHeight).toBe(0n);
    expect(read.item).toBeNull();
  });

  it("decodes each StorageItemInfo variant returned by the server", async () => {
    // Hand-rolled transport that returns scripted shapes per call so we
    // can exercise the per-variant demux without committing the mock to
    // a fixed return.
    const responses: unknown[] = [
      { blockHeight: 7, item: { kind: "nonnegativeInt", value: "12345" } },
      {
        blockHeight: 8,
        item: { kind: "bytestring", bytes: "0x0102deadbeef" },
      },
      { blockHeight: 9, item: { kind: "authData" } },
      { blockHeight: 10, item: { kind: "retrocausalQueue" } },
      { blockHeight: 11, item: { kind: "replayCacheEntry" } },
      {
        blockHeight: 12,
        item: {
          kind: "deployedContract",
          hash: "0x" + "ab".repeat(32),
          size: 4096,
          contract_type: 1,
        },
      },
      { blockHeight: 13, item: { kind: "unknown", type_id: 99 } },
    ];
    let i = 0;
    const transport: Transport = {
      async request<T>() {
        const r = responses[i++];
        return r as T;
      },
    };

    const r0 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r0.blockHeight).toBe(7n);
    expect(r0.item).toEqual({ kind: "nonnegativeInt", value: 12345n });

    const r1 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r1.item?.kind).toBe("bytestring");
    if (r1.item?.kind === "bytestring") {
      expect(Array.from(r1.item.bytes)).toEqual([
        0x01, 0x02, 0xde, 0xad, 0xbe, 0xef,
      ]);
    }

    const r2 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r2.item).toEqual({ kind: "authData" });

    const r3 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r3.item).toEqual({ kind: "retrocausalQueue" });

    const r4 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r4.item).toEqual({ kind: "replayCacheEntry" });

    const r5 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r5.item?.kind).toBe("deployedContract");
    if (r5.item?.kind === "deployedContract") {
      expect(r5.item.size).toBe(4096);
      expect(r5.item.contractType).toBe(1);
      expect(r5.item.hash.length).toBe(32);
    }

    const r6 = await getStorageAt(
      transport,
      contractAddress(new Uint8Array(32)),
      new Uint8Array(32),
    );
    expect(r6.item).toEqual({ kind: "unknown", typeId: 99 });
  });
});
