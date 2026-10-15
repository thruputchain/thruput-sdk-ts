import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createThruputClient,
  HttpTransport,
  addressFromBase58,
  hashFromBase58,
  toBase58,
} from "@thruputchain/client";
import { groundhog_erc20_if } from "@thruputchain/client/contracts";
import { ExecResult, HOG_ADDRESS } from "@thruputchain/protocol";

test("reads a CLI transfer through the SDK", async () => {
  assert.ok(process.env.THRUPUT_CLI_TRANSFER_RESULT);
  const result = JSON.parse(
    await readFile(process.env.THRUPUT_CLI_TRANSFER_RESULT, "utf8"),
  );
  const client = await createThruputClient({
    transport: new HttpTransport(result.rpcUrl),
  });
  const balance = await client.getBalance(addressFromBase58(result.recipient));
  assert.equal(toBase58(balance.address), result.recipient);
  assert.equal(balance.rawBalance, BigInt(result.after.rawBalance));
  const receipt = await client.getTransactionReceipt(
    hashFromBase58(result.txHash),
  );
  assert.ok(receipt, "CLI transfer receipt must be indexed");
  assert.equal(toBase58(receipt.txHash), result.txHash);
  assert.equal(receipt.execResult, ExecResult.ExecResultOK);
  const event = groundhog_erc20_if.v0_1.events.TransferEvent.singleFromReceipt(
    receipt,
    { contractAddress: HOG_ADDRESS },
  );
  assert.equal(toBase58(event.topics.from), result.sender);
  assert.equal(toBase58(event.topics.to), result.recipient);
  assert.equal(
    event.fields.amount,
    BigInt(result.after.rawBalance) - BigInt(result.before.rawBalance),
  );
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  const network = await client.getNetworkInfo();
  assert.equal(toBase58(network.networkHash), manifest.networkHash);
});
