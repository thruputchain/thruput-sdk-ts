// Read back the CLI checkpoint transaction through the built SDK.
// Called by thruput-tools/scripts/smoke-base58-local.py while its node is alive.
import assert from "node:assert/strict";
import {
  createThruputClient,
  HttpTransport,
  addressFromBase58,
  hashFromBase58,
  toBase58,
} from "../dist/index.js";

const [rpcUrl, recipient, txHash, expectedBalance] = process.argv.slice(2);
assert(
  rpcUrl && recipient && txHash && expectedBalance,
  "Expected RPC URL, recipient, transaction hash, and raw balance",
);
const client = await createThruputClient({
  transport: new HttpTransport(rpcUrl),
});
const balance = await client.getBalance(addressFromBase58(recipient));
assert.equal(toBase58(balance.address), recipient);
assert.equal(balance.rawBalance, BigInt(expectedBalance));
const receipt = await client.getTransactionReceipt(hashFromBase58(txHash));
assert(receipt, "Committed receipt must be indexed");
assert.equal(toBase58(receipt.txHash), txHash);
assert(receipt.events.length > 0, "HOG transfer should emit events");
for (const event of receipt.events) {
  assert.equal(event.contractAddress.length, 32);
  for (const topic of event.topics) assert(topic instanceof Uint8Array);
  assert(event.data instanceof Uint8Array);
}
const network = await client.getNetworkInfo();
assert.equal(network.networkHash.length, 32);
console.log(
  "PASS: SDK base58 balance, network identity, and receipt/event decoding",
);
