import { HttpTransport, createGroundhogClient } from "../src/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";
const client = createGroundhogClient(new HttpTransport(rpcUrl));

console.log(await client.getVersion());
