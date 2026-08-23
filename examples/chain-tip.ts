// Repository-local import; applications use "@groundhogchain/client".
import { connectGroundhogClient, devnet, toHex0x } from "../src/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL;
const client = await connectGroundhogClient({
  cluster: devnet(rpcUrl ? { rpcUrl } : {}),
});

const tip = await client.getChainTip();

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkId: client.network.networkId,
  genesisHash: toHex0x(client.network.genesisHash),
  height: tip.height.toString(),
  blockHash: toHex0x(tip.blockHash),
});
