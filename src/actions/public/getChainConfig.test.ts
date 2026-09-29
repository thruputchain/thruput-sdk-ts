import { describe, expect, it } from "vitest";
import type { Transport } from "../../transport/types.js";
import { getChainConfig } from "./getChainConfig.js";

function returning(result: unknown): Transport {
  return { request: async <T>() => result as T };
}

describe("getChainConfig", () => {
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
