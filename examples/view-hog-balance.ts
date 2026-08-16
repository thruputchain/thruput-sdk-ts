// Repository-local imports; applications use the published client entrypoints.
import {
  HttpTransport,
  addressFromHex,
  createGroundhogClient,
  toHex0x,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
import { loadLocalDevAccount } from "./helpers/local-dev.js";

const { address: accountAddress, rpcUrl } = await loadLocalDevAccount();

// HOG is predeployed on local/dev networks and implements the ERC20 interface.
const hogToken = addressFromHex(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

const client = createGroundhogClient(new HttpTransport(rpcUrl));

// Simulate the read-only ERC20 call and decode its typed result.
const response = await ERC20.getBalanceOf.view({
  client,
  contract: hogToken,
  caller: accountAddress,
  args: { addr: accountAddress },
});

console.log({
  rpcUrl,
  hogToken: toHex0x(hogToken),
  account: toHex0x(accountAddress),
  balance: response.value.toString(),
  height: response.height.toString(),
});
