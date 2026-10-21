import { describe, expect, it } from "vitest";
import { MockTransport } from "./mock.js";
import { createRpcClient } from "../rpc/client.js";
import { fromHex0x } from "../actions/hex.js";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
const bytes = fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr);
describe("native mock transport", () => {
  it("advertises only implemented methods and serves native named shapes", async () => {
    const client = await createRpcClient({ transport: new MockTransport() });
    expect(client.discovery.version.wireFormat).toBe("14.0.0");
    expect(client.discovery.version.supportedMethods).not.toContain(
      "dev_fundAccount",
    );
    expect(await client.getChainTip()).toMatchObject({ blockHeight: 0n });
    expect(await client.getBlockByHeight({ blockHeight: 0n })).toBeNull();
    expect(
      await client.getBalance({ address: new Uint8Array(32) }),
    ).toMatchObject({ rawBalance: 0n, stateBlockHeight: 0n });
  });
  it("uses canonical hashes, commits once and serves matching receipts", async () => {
    const client = await createRpcClient({ transport: new MockTransport() });
    const first = await client.sendTransaction({ signedTransaction: bytes }),
      second = await client.sendTransaction({ signedTransaction: bytes });
    expect(second).toEqual(first);
    expect(await client.getChainTip()).toMatchObject({ blockHeight: 1n });
    expect(
      await client.getTransactionStatus({
        transactionHash: first.transactionHash,
      }),
    ).toEqual({ status: "committed", blockHeight: 1n });
    expect(
      await client.getTransactionReceipt({
        transactionHash: first.transactionHash,
      }),
    ).toMatchObject({
      transactionHash: first.transactionHash,
      blockHeight: 1n,
      execution: { result: "return" },
    });
    expect(await client.getBlockByHeight({ blockHeight: 1n })).toMatchObject({
      blockHeight: 1n,
    });
  });
  it("returns null for missing history and rejects positional params", async () => {
    const transport = new MockTransport(),
      client = await createRpcClient({ transport });
    expect(
      await client.getTransactionReceipt({
        transactionHash: new Uint8Array(32),
      }),
    ).toBeNull();
    expect(
      await client.getStorage({
        address: new Uint8Array(32),
        key: new Uint8Array(),
      }),
    ).toEqual({ item: null, stateBlockHeight: 0n });
    await expect(transport.request("getChainTip", [])).rejects.toThrow(
      "named object",
    );
  });
});
