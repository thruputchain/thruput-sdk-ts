import { HOG_ADDRESS } from "@thruputchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  createThruputClient,
  formatUnits,
  localnet,
  toHex0x,
  addressFromHex,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
const rpcUrl = process.env.THRUPUT_RPC_URL;
const addressHex = process.env.THRUPUT_ADDRESS;
if (!addressHex)
  throw new Error(
    "Set THRUPUT_ADDRESS to the public account address to inspect",
  );
const address = addressFromHex(addressHex);

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
  hogToken: toHex0x(HOG_ADDRESS),
  account: toHex0x(address),
  balance: response.value.toString(),
  hog: formatUnits(response.value, 7),
  height: response.height.toString(),
});
