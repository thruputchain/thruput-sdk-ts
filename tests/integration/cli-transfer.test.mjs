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
import { thruput_erc20_if } from "@thruputchain/client/contracts";
import { NATIVE_TOKEN_ADDRESS } from "@thruputchain/protocol";

test("reads a CLI transfer through the SDK", async () => {
  assert.ok(process.env.THRUPUT_CLI_TRANSFER_RESULT);
  const result = JSON.parse(
    await readFile(process.env.THRUPUT_CLI_TRANSFER_RESULT, "utf8"),
  );
  const client = await createThruputClient({
    transport: new HttpTransport(result.rpcUrl),
  });
  const balance = await client.getBalance({
    address: addressFromBase58(result.recipient),
  });
  assert.equal(toBase58(balance.address), result.recipient);
  assert.equal(balance.rawBalance, BigInt(result.after.rawBalance));
  const receipt = await client.getTransactionReceipt({
    transactionHash: hashFromBase58(result.txHash),
  });
  assert.ok(receipt, "CLI transfer receipt must be indexed");
  assert.equal(toBase58(receipt.transactionHash), result.txHash);
  assert.equal(receipt.execution.result, "return");
  const event = thruput_erc20_if.v0_1.events.TransferEvent.singleFromReceipt(
    receipt,
    { address: NATIVE_TOKEN_ADDRESS },
  );
  assert.equal(toBase58(event.topics.from), result.sender);
  assert.equal(toBase58(event.topics.to), result.recipient);
  // Evidence records the requested amount and independently known deposit.
  // A first credit may reserve storage instead of making all tokens spendable.
  assert.match(result.rawAmount, /^[1-9][0-9]*$/);
  assert.match(result.storageDepositRaw, /^(0|[1-9][0-9]*)$/);
  const amount = BigInt(result.rawAmount);
  const deposit = BigInt(result.storageDepositRaw);
  assert.ok(deposit <= amount);
  assert.equal(event.fields.amount, amount);
  assert.equal(
    BigInt(result.after.rawBalance) - BigInt(result.before.rawBalance),
    amount - deposit,
  );
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  const network = await client.getNetworkInfo();
  assert.equal(toBase58(network.networkHash), manifest.networkHash);
});
