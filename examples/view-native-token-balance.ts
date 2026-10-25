import { NATIVE_TOKEN_ADDRESS } from "@thruputchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import {
  createThruputClient,
  formatUnits,
  toBase58,
  addressFromBase58,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
import { exampleCluster } from "./lib/cluster.js";
const addressText = process.env.THRUPUT_ADDRESS;
if (!addressText)
  throw new Error(
    "Set THRUPUT_ADDRESS to the public account address to inspect",
  );
const address = addressFromBase58(addressText);

const client = await createThruputClient({
  cluster: exampleCluster("localnet"),
});

// Simulate the read-only ERC20 call and decode its typed result.
const response = await ERC20.v0_1.getBalanceOf.view({
  client,
  address: NATIVE_TOKEN_ADDRESS,
  caller: address,
  args: { addr: address },
});

console.log({
  rpcUrl: client.cluster.rpcUrl,
  nativeToken: toBase58(NATIVE_TOKEN_ADDRESS),
  account: toBase58(address),
  balance: response.value.toString(),
  formattedBalance: formatUnits(response.value, 7),
  height: response.stateBlockHeight.toString(),
});
