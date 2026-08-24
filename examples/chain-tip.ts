// Repository-local import; applications use "@groundhogchain/client".
import { HttpTransport, createGroundhogClient, toHex0x } from "../src/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";
const client = createGroundhogClient(
  new HttpTransport(rpcUrl, { timeoutMs: 10_000 }),
);

const tip = await client.getChainTip();

console.log({
  height: tip.height.toString(),
  blockHash: toHex0x(tip.blockHash),
});
