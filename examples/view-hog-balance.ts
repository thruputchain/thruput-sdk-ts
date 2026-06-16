import { CxsReader, Uint128Codec, gasAmount } from "@groundhogchain/protocol";
import {
  HttpTransport,
  addressFromHex,
  createGroundhogClient,
  toHex0x,
} from "../src/index.js";
import { ERC20 } from "../src/contracts/index.js";

const rpcUrl = process.env.GROUNDHOG_RPC_URL ?? "http://127.0.0.1:9545";
const accountAddress = addressFromHex(
  process.env.GROUNDHOG_ACCOUNT_ADDRESS ??
    "0x7171717171717171717171717171717171717171717171717171717171717171",
);

// HOG is predeployed on local/dev networks and implements the ERC20 interface.
const hogToken = addressFromHex(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

const client = createGroundhogClient(new HttpTransport(rpcUrl));

// Build a read-only ERC20 getBalanceOf call for dev-0.
const invocation = ERC20.getBalanceOf(hogToken, gasAmount(500_000n), {
  addr: accountAddress,
});

// `view` simulates the contract call and returns raw CXS bytes.
const response = await client.view({
  contract: invocation.invoked_address,
  entrypoint: invocation.entrypoint,
  calldata: invocation.calldata,
  caller: accountAddress,
});

if (response.output.result !== "return") {
  throw new Error(`HOG balance view did not return: ${response.output.result}`);
}

// ERC20 getBalanceOf returns a CXS-encoded U128.
const reader = new CxsReader(response.output.returnData);
const balance = Uint128Codec.decode(reader);

if (reader.remaining !== 0) {
  throw new Error(`Trailing balance bytes: ${reader.remaining}`);
}

console.log({
  rpcUrl,
  hogToken: toHex0x(hogToken),
  account: toHex0x(accountAddress),
  balance: balance.toString(),
  height: response.height.toString(),
});
