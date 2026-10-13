import { describe, expect, it, vi } from "vitest";
import { contractAddress, gasAmount, sha256Hash } from "@thruputchain/protocol";
import { createThruputClient, type ThruputClient } from "../../client.js";
import { getContract } from "../../contract/instance.js";
import { ERC20 } from "../../contracts/erc20.js";
import { HttpTransport } from "../../transport/http.js";

const address = contractAddress(new Uint8Array(32));
const hash = sha256Hash(new Uint8Array(32));
const invocation = ERC20.v0_1.getBalance.invocation(address, gasAmount(1n));
const reads: Record<
  string,
  (client: ThruputClient, signal: AbortSignal) => Promise<unknown>
> = {
  network: (client, signal) => client.getNetworkInfo({ signal }),
  chainConfig: (client, signal) => client.getChainConfig({ signal }),
  version: (client, signal) => client.getVersion({ signal }),
  tip: (client, signal) => client.getChainTip({ signal }),
  balance: (client, signal) => client.getBalance(address, { signal }),
  block: (client, signal) => client.getBlockByNumber(0n, { signal }),
  pending: (client, signal) => client.getPendingTransactionCount({ signal }),
  receipt: (client, signal) => client.getTransactionReceipt(hash, { signal }),
  status: (client, signal) => client.getTransactionStatus(hash, { signal }),
  transactions: (client, signal) =>
    client.getTransactionsByAddress({ address }, { signal }),
  events: (client, signal) =>
    client.getEvents(
      { filters: [{ contractAddresses: [address] }] },
      { signal },
    ),
  storage: (client, signal) =>
    client.getStorageAt(address, new Uint8Array(32), { signal }),
  view: (client, signal) =>
    client.view(
      {
        contract: address,
        entrypoint: invocation.entrypoint,
        calldata: invocation.calldata,
      },
      { signal },
    ),
  descriptor: (client, signal) =>
    ERC20.v0_1.getBalance.view({ client, contract: address, signal }),
  outcome: (client, signal) =>
    ERC20.v0_1.getBalance.viewOutcome({ client, contract: address, signal }),
  bound: (client, signal) =>
    getContract({ binding: ERC20.v0_1, address, client }).getBalance.view({
      signal,
    }),
  boundOutcome: (client, signal) =>
    getContract({
      binding: ERC20.v0_1,
      address,
      client,
    }).getBalance.viewOutcome({
      signal,
    }),
};

describe.each(Object.entries(reads))("%s cancellation", (_, read) => {
  it("does not dispatch a pre-aborted read", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = await createThruputClient({
      transport: new HttpTransport("https://rpc.example", { fetch }),
    });
    const reason = new Error("view unmounted");
    await expect(read(client, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels in-flight reads independently on one transport", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_, init) =>
        new Promise((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        }),
    );
    const client = await createThruputClient({
      transport: new HttpTransport("https://rpc.example", {
        fetch,
        timeoutMs: 5_000,
      }),
    });
    const first = new AbortController();
    const second = new AbortController();
    const firstRead = read(client, first.signal);
    const secondRead = read(client, second.signal);
    const firstReason = new Error("first stopped");
    first.abort(firstReason);
    await expect(firstRead).rejects.toBe(firstReason);
    expect(fetch.mock.calls[1]![1]!.signal!.aborted).toBe(false);
    const secondReason = new Error("second stopped");
    second.abort(secondReason);
    await expect(secondRead).rejects.toBe(secondReason);
  });
});
