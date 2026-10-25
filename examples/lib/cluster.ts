import { networkHash } from "@thruputchain/protocol";
import { futurenet, localnet, hashFromBase58 } from "../../src/index.js";

/** Select the example network without changing its default. */
export function exampleCluster(defaultNetwork: "localnet" | "futurenet") {
  const network = process.env.THRUPUT_NETWORK ?? defaultNetwork;
  const options = {
    ...(process.env.THRUPUT_RPC_URL
      ? { rpcUrl: process.env.THRUPUT_RPC_URL }
      : {}),
    ...(process.env.THRUPUT_NETWORK_HASH
      ? {
          networkHash: networkHash(
            hashFromBase58(process.env.THRUPUT_NETWORK_HASH),
          ),
        }
      : {}),
  };
  if (network === "localnet") return localnet(options);
  if (network === "futurenet") return futurenet(options);
  throw new Error("THRUPUT_NETWORK must be localnet or futurenet");
}
