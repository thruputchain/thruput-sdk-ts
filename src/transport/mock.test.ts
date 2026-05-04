import { describe, expect, it } from "vitest";
import { MockTransport } from "./mock.js";

describe("MockTransport", () => {
  it("returns chain tip at height 0 when empty", async () => {
    const transport = new MockTransport();
    const tip = await transport.request<{ height: string; blockHash: string }>(
      "groundhog_chainTip",
    );
    expect(tip.height).toBe("0x0");
    expect(tip.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("stores a transaction and increments height on sendRawTransaction", async () => {
    const transport = new MockTransport();
    const result = await transport.request<{ txHash: string }>(
      "groundhog_sendRawTransaction",
      ["0xdeadbeef"],
    );
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const tip = await transport.request<{ height: string }>(
      "groundhog_chainTip",
    );
    expect(tip.height).toBe("0x1");
  });

  it("returns receipt for a committed transaction", async () => {
    const transport = new MockTransport();
    const { txHash } = await transport.request<{ txHash: string }>(
      "groundhog_sendRawTransaction",
      ["0xabcd"],
    );
    const receipt = await transport.request<{
      txHash: string;
      height: string;
      status: { result: string };
      events: unknown[];
      returnData: null;
    }>("groundhog_getTransactionReceipt", [txHash]);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toBe(txHash);
    expect(receipt!.status.result).toBe("ok");
    expect(receipt!.events).toEqual([]);
  });

  it("returns null receipt for unknown transaction", async () => {
    const transport = new MockTransport();
    const receipt = await transport.request(
      "groundhog_getTransactionReceipt",
      ["0x" + "00".repeat(32)],
    );
    expect(receipt).toBeNull();
  });

  it("returns committed status for a known transaction", async () => {
    const transport = new MockTransport();
    const { txHash } = await transport.request<{ txHash: string }>(
      "groundhog_sendRawTransaction",
      ["0x1234"],
    );
    const status = await transport.request<{
      status: string;
      height?: string;
    }>("groundhog_getTransactionStatus", [txHash]);
    expect(status.status).toBe("committed");
    expect(status.height).toBe("0x1");
  });

  it("returns unknown status for an unknown transaction", async () => {
    const transport = new MockTransport();
    const status = await transport.request<{ status: string }>(
      "groundhog_getTransactionStatus",
      ["0x" + "ff".repeat(32)],
    );
    expect(status.status).toBe("unknown");
  });

  it("clears all state on dev_reset", async () => {
    const transport = new MockTransport();
    await transport.request("groundhog_sendRawTransaction", ["0xaa"]);
    await transport.request("groundhog_sendRawTransaction", ["0xbb"]);

    const tipBefore = await transport.request<{ height: string }>(
      "groundhog_chainTip",
    );
    expect(tipBefore.height).toBe("0x2");

    await transport.request("groundhog_dev_reset");

    const tipAfter = await transport.request<{ height: string }>(
      "groundhog_chainTip",
    );
    expect(tipAfter.height).toBe("0x0");
  });

  it("returns 3 deterministic dev accounts", async () => {
    const transport = new MockTransport();
    const accounts = await transport.request<
      {
        address: string;
        publicKey: string;
        privateKey: string;
        storageTokens: string;
      }[]
    >("groundhog_dev_getAccounts");
    expect(accounts).toHaveLength(3);
    for (const account of accounts) {
      expect(account.address).toMatch(/^0x[0-9a-f]{64}$/);
      expect(account.publicKey).toMatch(/^0x[0-9a-f]+$/);
      expect(account.privateKey).toMatch(/^0x[0-9a-f]+$/);
      expect(account.storageTokens).toBe("0xf4240");
    }

    // Verify determinism: calling again returns the same accounts
    const accounts2 = await transport.request<
      { address: string }[]
    >("groundhog_dev_getAccounts");
    expect(accounts2[0].address).toBe(accounts[0].address);
  });

  it("throws for unknown methods", async () => {
    const transport = new MockTransport();
    await expect(
      transport.request("groundhog_nonExistentMethod"),
    ).rejects.toThrow("MockTransport: method not implemented");
  });
});
