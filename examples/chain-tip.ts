// Repository-local import; applications use "@groundhogchain/client".
import { createGroundhogClient, devnet, toHex0x } from "../src/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL;
const client = await createGroundhogClient({
  cluster: devnet(rpcUrl ? { rpcUrl } : {}),
});

const tip = await client.getChainTip();

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkHash: toHex0x(client.network.networkHash),
  genesisHash: toHex0x(client.network.genesisHash),
  height: tip.height.toString(),
  blockHash: toHex0x(tip.blockHash),
});
