import { CxsReader, Uint128Codec, gasAmount } from "@groundhogchain/protocol";
import {
  HttpTransport,
  addressFromHex,
  createGroundhogClient,
  toHex0x,
} from "../src/index.js";
import { getBalanceOf } from "../src/contracts/erc20.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";

// HOG is predeployed on local/dev networks and implements the ERC20 interface.
const hogToken = addressFromHex(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

const client = createGroundhogClient(new HttpTransport(rpcUrl));

// This is a local-dev-helper script. It needs a dev node exposing
// `groundhog_dev_getAccounts` so it can discover a bootstrap wallet.
const accounts = await client.dev.getAccounts();
const account = accounts[0];

if (!account) {
  throw new Error("view-hog-balance requires at least one dev account");
}

// Build a read-only ERC20 get_balance_of call for dev-0.
const invocation = getBalanceOf(hogToken, gasAmount(500_000n), {
  addr: account.address,
});

// `view` simulates the contract call and returns raw CXS bytes.
const response = await client.view({
  contract: invocation.invoked_address,
  entrypoint: invocation.entrypoint,
  calldata: invocation.calldata,
  caller: account.address,
});

if (response.output.result !== "return") {
  throw new Error(`HOG balance view did not return: ${response.output.result}`);
}

// ERC20 get_balance_of returns a CXS-encoded U128.
const reader = new CxsReader(response.output.returnData);
const balance = Uint128Codec.decode(reader);

if (reader.remaining !== 0) {
  throw new Error(`Trailing balance bytes: ${reader.remaining}`);
}

console.log({
  rpcUrl,
  hogToken: toHex0x(hogToken),
  account: toHex0x(account.address),
  balance: balance.toString(),
  height: response.height.toString(),
});
