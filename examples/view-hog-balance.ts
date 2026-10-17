import { HOG_ADDRESS } from "@thruputchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  createThruputClient,
  formatUnits,
  localnet,
  toBase58,
  addressFromBase58,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
const rpcUrl = process.env.THRUPUT_RPC_URL;
const addressText = process.env.THRUPUT_ADDRESS;
if (!addressText)
  throw new Error(
    "Set THRUPUT_ADDRESS to the public account address to inspect",
  );
const address = addressFromBase58(addressText);

const client = await createThruputClient({
  cluster: localnet(rpcUrl ? { rpcUrl } : {}),
});

// Simulate the read-only ERC20 call and decode its typed result.
const response = await ERC20.v0_1.getBalanceOf.view({
  client,
  contract: HOG_ADDRESS,
  caller: address,
  args: { addr: address },
});

console.log({
  rpcUrl: client.cluster.rpcUrl,
  hogToken: toBase58(HOG_ADDRESS),
  account: toBase58(address),
  balance: response.value.toString(),
  hog: formatUnits(response.value, 7),
  height: response.height.toString(),
});
