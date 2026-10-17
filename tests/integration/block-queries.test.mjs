import assert from "node:assert/strict";
import versions from "../../scripts/integration-versions.json" with { type: "json" };
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  HttpTransport,
  PrivateKeySigner,
  createPubkeyAccount,
  createThruputClient,
  fundAccount,
  addressFromBase58,
  toHex0x,
} from "@thruputchain/client";

async function eventually(read) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await sleep(50);
  }
  throw new Error("Timed out waiting for indexed block data");
}

test(
  "block metadata and bounded hash walks agree with funded receipts",
  { timeout: 120_000 },
  async () => {
    const transport = new HttpTransport(process.env.THRUPUT_RPC_URL, {
      timeoutMs: 5000,
    });
    const client = await createThruputClient({ transport });
    assert.equal(
      (await client.getVersion()).wireFormat,
      process.env.THRUPUT_EXPECTED_WIRE_FORMAT ?? versions.wireFormat,
    );
    const manifest = JSON.parse(
      await readFile(process.env.THRUPUT_RUNTIME_MANIFEST, "utf8"),
    );
    const faucet = addressFromBase58(
      manifest.bootstrapAccounts.find((account) => account.role === "faucet")
        .walletAddress,
    );
    const account = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
    });
    // Submit together during the interval driver so a block has multiple refs.
    const admitted = await Promise.all(
      Array.from({ length: 6 }, () =>
        fundAccount(transport, {
          recipient: account.address,
          faucet,
          rawAmount: 100000000n,
          clientNonce: randomBytes(16),
        }),
      ),
    );
    const receipts = await Promise.all(
      admitted.map((tx) =>
        eventually(() => client.getTransactionReceipt(tx.txHash)),
      ),
    );
    const byHeight = new Map();
    for (const receipt of receipts) {
      const hashes = byHeight.get(receipt.height) ?? [];
      hashes.push(toHex0x(receipt.txHash));
      byHeight.set(receipt.height, hashes);
    }
    assert.ok(
      [...byHeight.values()].some((hashes) => hashes.length > 1),
      "corpus must exercise continuation pages",
    );
    for (const [height, expected] of byHeight) {
      const block = await eventually(() => client.getBlockByNumber(height));
      assert.equal(block.blockHeight, height);
      if (height > 1n) {
        const parent = await client.getBlockByNumber(height - 1n);
        assert.equal(toHex0x(block.prevBlockHash), toHex0x(parent.blockHash));
      }
      for (const order of ["ascending", "descending"]) {
        const found = [];
        let cursor = new Uint8Array();
        do {
          const page = await client.getTransactionsByBlock({
            height,
            order,
            cursor,
            limit: 1,
          });
          assert.equal(page.oldestBlock, 1n);
          assert.ok(page.latestBlock >= height);
          assert.equal(page.refs.length, 1);
          assert.equal(page.refs[0].height, height);
          found.push(toHex0x(page.refs[0].txHash));
          assert.ok(
            found.length <= expected.length,
            "walk repeated or included unrelated refs",
          );
          cursor = page.cursor;
        } while (cursor.length !== 0);
        const sorted = [...expected].sort();
        if (order === "descending") sorted.reverse();
        assert.deepEqual(found, sorted);
      }
    }
    const lastFunded = [...byHeight.keys()].reduce((a, b) => (a > b ? a : b));
    const empty = await eventually(() =>
      client.getBlockByNumber(lastFunded + 1n),
    );
    assert.equal(empty.blockHeight, lastFunded + 1n);
    assert.equal(
      toHex0x(empty.prevBlockHash),
      toHex0x((await client.getBlockByNumber(lastFunded)).blockHash),
    );
    const emptyPage = await client.getTransactionsByBlock({
      height: empty.blockHeight,
    });
    assert.equal(emptyPage.refs.length, 0);
    assert.equal(emptyPage.cursor.length, 0);
    assert.equal(await client.getBlockByNumber(0n), null);
    assert.equal(await client.getBlockByNumber((1n << 63n) - 1n), null);
    await assert.rejects(
      client.getTransactionsByBlock({ height: empty.blockHeight, limit: 0 }),
      /limit/,
    );
    const tip = await client.getChainTip();
    const tipBlock = await eventually(() =>
      client.getBlockByNumber(tip.height),
    );
    assert.equal(toHex0x(tipBlock.blockHash), toHex0x(tip.blockHash));
  },
);
