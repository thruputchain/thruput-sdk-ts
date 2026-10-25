// Repository-local import; applications use "@thruputchain/client".
import { createThruputClient, toBase58 } from "../src/index.js";
import { exampleCluster } from "./lib/cluster.js";

const client = await createThruputClient({
  cluster: exampleCluster("futurenet"),
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
