// Repository-local import; applications use "@groundhogchain/client".
import { createGroundhogClient, devnet, toHex0x } from "../src/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL;
const client = await createGroundhogClient({
  cluster: devnet(rpcUrl ? { rpcUrl } : {}),
});

const [tip, version] = await Promise.all([
  client.getChainTip(),
  client.getVersion(),
]);

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkHash: toHex0x(client.network.networkHash),
  height: tip.height.toString(),
  blockHash: toHex0x(tip.blockHash),
  wireFormat: version.wireFormat,
  implementation: version.implementation,
  releaseVersion: version.releaseVersion,
  bundleManifestDigest: version.bundleManifestDigest,
});
