import { describe, expect, it } from "vitest";
import type { Transport } from "../../transport/types.js";
import { createThruputClient } from "../../client.js";
import { getChainConfig } from "./getChainConfig.js";

function returning(result: unknown): Transport {
  return { request: async <T>() => result as T };
}

describe("getChainConfig", () => {
  const execution = {
    observedTip: { height: "42", blockHash: `0x${"11".repeat(32)}` },
    configHash: `0x${"22".repeat(32)}`,
    effectiveLimits: { maxContractSizeBytes: 100_000 },
    storageCosts: {
      baseDataItemCost: "12000",
      bytestringCostPerByte: "0",
      baseContractDeploymentCost: "12000",
      contractDeploymentCostPerByte: "10",
      authPerKeyCost: "1111",
      rcqCostPerEntry: "8",
      replayCacheCostPerEntry: "7",
      balanceCost: "18446744073709551615",
    },
  };

  it("keeps prices exact and resolved limits distinct from stated limits", async () => {
    const config = await getChainConfig(returning({ execution }));
    expect(config.maxContractSizeBytes).toBeNull();
    expect(config.execution?.effectiveLimits.maxContractSizeBytes).toBe(
      100_000,
    );
    expect(config.execution?.observedTip.height).toBe(42n);
    expect(config.execution?.storageCosts.balanceCost).toBe(
      18446744073709551615n,
    );
    expect(config.execution?.storageCosts.bytestringCostPerByte).toBe(0n);
    expect(config.execution?.effectiveLimits.maxRv32MemoryBytes).toBeNull();
    expect(config.execution?.configHash).toEqual(new Uint8Array(32).fill(0x22));
    expect(config.execution?.observedTip.blockHash).toEqual(
      new Uint8Array(32).fill(0x11),
    );
  });

  it("preserves zero prices and the maximum u32 byte price", async () => {
    const config = await getChainConfig(
      returning({
        execution: {
          ...execution,
          storageCosts: {
            ...execution.storageCosts,
            balanceCost: "0",
            bytestringCostPerByte: "4294967295",
          },
        },
      }),
    );
    expect(config.execution?.storageCosts.balanceCost).toBe(0n);
    expect(config.execution?.storageCosts.bytestringCostPerByte).toBe(
      4294967295n,
    );
  });

  it.each(Object.keys(execution.storageCosts))(
    "rejects a missing %s price",
    async (field) => {
      await expect(
        getChainConfig(
          returning({
            execution: {
              ...execution,
              storageCosts: { ...execution.storageCosts, [field]: undefined },
            },
          }),
        ),
      ).rejects.toThrow(`storageCosts.${field}`);
    },
  );

  it("propagates a bound client's read failure after a successful reading", async () => {
    const error = new Error("storage prices unavailable");
    let failed = false;
    const transport: Transport = {
      request: async <T>() => {
        if (failed) throw error;
        return { execution } as T;
      },
    };
    const client = await createThruputClient({ transport });
    expect((await client.getChainConfig()).execution?.observedTip.height).toBe(
      42n,
    );
    failed = true;
    await expect(client.getChainConfig()).rejects.toBe(error);
  });

  it.each([
    undefined,
    null,
    "",
    "-1",
    "-0",
    "+1",
    "01",
    "1.5",
    "1\n",
    "18446744073709551616",
    100,
  ])("rejects unavailable or invalid price %s", async (balanceCost) => {
    await expect(
      getChainConfig(
        returning({
          execution: {
            ...execution,
            storageCosts: { ...execution.storageCosts, balanceCost },
          },
        }),
      ),
    ).rejects.toThrow("Invalid chain config response");
  });
  it("reports unstated parameters as null", async () => {
    await expect(
      getChainConfig(
        returning({ maxSavepointDepth: 16, maxSha256Buffers: null }),
      ),
    ).resolves.toEqual({
      maxAuthTokenDepth: null,
      maxBytestringLen: null,
      maxContractSizeBytes: null,
      maxCrossInvokeDepth: null,
      maxNewContractsPerTx: null,
      maxRv32CodeBytes: null,
      maxRv32MemoryBytes: null,
      maxSavepointDepth: 16,
      maxSha256Buffers: null,
    });
  });

  it("rejects a per-byte price beyond u32", async () => {
    await expect(
      getChainConfig(
        returning({
          execution: {
            ...execution,
            storageCosts: {
              ...execution.storageCosts,
              bytestringCostPerByte: "4294967296",
            },
          },
        }),
      ),
    ).rejects.toThrow("storageCosts.bytestringCostPerByte");
  });

  it.each(["0", "9007199254740993", "9223372036854775807"])(
    "preserves the exact committed height %s",
    async (height) => {
      const config = await getChainConfig(
        returning({
          execution: {
            ...execution,
            observedTip: { ...execution.observedTip, height },
          },
        }),
      );
      expect(config.execution?.observedTip.height).toBe(BigInt(height));
    },
  );

  it.each([
    undefined,
    null,
    42,
    Number.MAX_SAFE_INTEGER + 1,
    "-1",
    "9223372036854775808",
    "01",
    "1\n",
  ])("rejects an invalid committed height %s", async (height) => {
    await expect(
      getChainConfig(
        returning({
          execution: {
            ...execution,
            observedTip: { ...execution.observedTip, height },
          },
        }),
      ),
    ).rejects.toThrow("observedTip.height");
  });

  it.each([
    ["a non-object", 7, "Invalid chain config response"],
    ["an array", [], "Invalid chain config response"],
    [
      "a string parameter",
      { maxSavepointDepth: "16" },
      "expected u32 maxSavepointDepth",
    ],
    [
      "a negative parameter",
      { maxAuthTokenDepth: -1 },
      "expected u32 maxAuthTokenDepth",
    ],
    [
      "a parameter above u32",
      { maxBytestringLen: 2 ** 32 },
      "expected u32 maxBytestringLen",
    ],
  ])("rejects %s", async (_, result, message) => {
    await expect(getChainConfig(returning(result))).rejects.toThrow(message);
  });
});
