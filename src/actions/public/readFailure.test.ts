import { describe, expect, it, vi } from "vitest";
import { contractAddress, sha256Hash } from "@groundhogchain/protocol";
import type { Transport } from "../../transport/types.js";
import { ContractDecodeError } from "../../contract/errors.js";
import { HttpResponseError } from "../../transport/http.js";
import { requestAirdrop } from "./requestAirdrop.js";
import { waitForTransactionReceipt } from "./waitForTransactionReceipt.js";

const waiters: Record<string, (transport: Transport) => Promise<unknown>> = {
  receipt: (transport) =>
    waitForTransactionReceipt(transport, sha256Hash(new Uint8Array(32))),
  airdrop: (transport) =>
    requestAirdrop(transport, {
      recipient: contractAddress(new Uint8Array(32)),
    }),
};

describe.each(Object.entries(waiters))("%s read failures", (_, wait) => {
  it.each([
    new TypeError("invalid local input"),
    new DOMException("custom fetch stopped", "AbortError"),
    new ContractDecodeError("invalid data", {
      cause: new HttpResponseError(503, "nested diagnostic"),
    }),
  ])("does not retry or replace %s", async (error) => {
    const request = vi.fn(async () => {
      throw error;
    });
    await expect(wait({ request })).rejects.toBe(error);
    expect(request).toHaveBeenCalledOnce();
  });
});
