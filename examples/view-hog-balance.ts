import { HOG_ADDRESS } from "@groundhogchain/protocol";
// Repository-local imports; applications use the published client entrypoints.
import { createGroundhogClient, localnet, toHex0x } from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";
import { loadLocalDevAccount } from "../src/local-dev/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL;
if (rpcUrl && !process.env.GROUNDHOG_RUNTIME_MANIFEST) {
  throw new Error(
    "Set GROUNDHOG_RUNTIME_MANIFEST when overriding the Localnet RPC URL",
  );
}
const account = await loadLocalDevAccount();

const client = await createGroundhogClient({
  cluster: localnet(rpcUrl ? { rpcUrl } : {}),
});

// Simulate the read-only ERC20 call and decode its typed result.
const response = await ERC20.v0_1.getBalanceOf.view({
  client,
  contract: HOG_ADDRESS,
  caller: account.address,
  args: { addr: account.address },
});

console.log({
  rpcUrl: client.cluster.rpcUrl,
  accountName: account.keyName,
  hogToken: toHex0x(HOG_ADDRESS),
  account: toHex0x(account.address),
  balance: response.value.toString(),
  height: response.height.toString(),
});
