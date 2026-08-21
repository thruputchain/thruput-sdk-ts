import { HOG_ADDRESS } from "@groundhogchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import { HttpTransport, createGroundhogClient, toHex0x } from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
import { loadLocalDevAccount } from "../src/local-dev/index.js";

const { address: accountAddress, rpcUrl } = await loadLocalDevAccount();

const client = createGroundhogClient(new HttpTransport(rpcUrl));

// Simulate the read-only ERC20 call and decode its typed result.
const response = await ERC20.getBalanceOf.view({
  client,
  contract: HOG_ADDRESS,
  caller: accountAddress,
  args: { addr: accountAddress },
});

console.log({
  rpcUrl,
  hogToken: toHex0x(HOG_ADDRESS),
  account: toHex0x(accountAddress),
  balance: response.value.toString(),
  height: response.height.toString(),
});
