// Repository-local import; applications use "@thruputchain/client".
import { createThruputClient, devnet, toBase58 } from "../src/index.js";

const rpcUrl = process.env.THRUPUT_RPC_URL;
const client = await createThruputClient({
  cluster: devnet(rpcUrl ? { rpcUrl } : {}),
});

const [tip, version] = await Promise.all([
  client.getChainTip(),
  client.getVersionInfo(),
]);

console.log({
  rpcUrl: client.cluster.rpcUrl,
  networkHash: toBase58(client.network.networkHash),
  height: tip.blockHeight.toString(),
  blockHash: toBase58(tip.blockHash),
  wireFormat: version.wireFormat,
  implementation: version.implementation,
  releaseVersion: version.releaseVersion,
  bundleManifestDigest: version.bundleManifestDigest,
});
