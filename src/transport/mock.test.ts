import { describe, expect, it } from "vitest";
import { MockTransport } from "./mock.js";

describe("MockTransport", () => {
  it("returns chain tip at height 0 when empty", async () => {
    const transport = new MockTransport();
    const tip = await transport.request<{ height: number; blockHash: string }>(
      "groundhog_chainTip",
    );
    expect(tip.height).toBe(0);
    expect(tip.blockHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("returns zero native HOG balance for requested address", async () => {
    const transport = new MockTransport();
    const address = "0x" + "ab".repeat(32);
    const balance = await transport.request<{
      address: string;
      rawBalance: string;
      height: number;
    }>("groundhog_getBalance", [address]);

    expect(balance).toEqual({ address, rawBalance: "0", height: 0 });
  });

  it("stores a transaction and increments height on sendRawTransaction", async () => {
    const transport = new MockTransport();
    const hash = await transport.request<string>(
      "groundhog_sendRawTransaction",
      ["0xdeadbeef"],
    );
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    const tip = await transport.request<{ height: number }>(
      "groundhog_chainTip",
    );
    expect(tip.height).toBe(1);
  });

  it("returns receipt for a committed transaction", async () => {
    const transport = new MockTransport();
    const hash = await transport.request<string>(
      "groundhog_sendRawTransaction",
      ["0xabcd"],
    );
    const receipt = await transport.request<{
      txHash: string;
      height: number;
      status: { result: string };
      events: unknown[];
      returnData: null;
      abortData: null;
    }>("groundhog_getTransactionReceipt", [hash]);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toBe(hash);
    expect(receipt!.status.result).toBe("ok");
    expect(receipt!.events).toEqual([]);
  });

  it("returns null receipt for unknown transaction", async () => {
    const transport = new MockTransport();
    const receipt = await transport.request("groundhog_getTransactionReceipt", [
      "0x" + "00".repeat(32),
    ]);
    expect(receipt).toBeNull();
  });

  it("returns committed status for a known transaction", async () => {
    const transport = new MockTransport();
    const hash = await transport.request<string>(
      "groundhog_sendRawTransaction",
      ["0x1234"],
    );
    const status = await transport.request<{
      status: string;
      height?: number;
    }>("groundhog_getTransactionStatus", [hash]);
    expect(status.status).toBe("committed");
    expect(status.height).toBe(1);
  });

  it("returns unknown status for an unknown transaction", async () => {
    const transport = new MockTransport();
    const status = await transport.request<{ status: string }>(
      "groundhog_getTransactionStatus",
      ["0x" + "ff".repeat(32)],
    );
    expect(status.status).toBe("unknown");
  });

  it("throws for unknown methods", async () => {
    const transport = new MockTransport();
    await expect(
      transport.request("groundhog_nonExistentMethod"),
    ).rejects.toThrow("MockTransport: method not implemented");
  });
});
