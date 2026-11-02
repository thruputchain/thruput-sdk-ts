import { expect, it } from "vitest";
import { calldata, contractAddress, gasAmount } from "@thruputchain/protocol";
import { DefaultWallet, spec } from "../contracts/default_wallet.js";
import { ERC20 } from "../contracts/erc20.js";
import { createContractCallDecoder } from "./specMethod.js";
import { decodeDefaultWalletRequests } from "../actions/public/decodeWalletRequests.js";

const address = contractAddress(new Uint8Array(32).fill(3));
const child = ERC20.v0_1.transfer.call({
  address,
  gasLimit: gasAmount(10000n),
  args: { receiver: address, amount: 10n },
}).invocation;
const root = DefaultWallet.v0_1.execute.call({
  address,
  gasLimit: gasAmount(20000n),
  args: {
    calls: [
      {
        target: child.invoked_address,
        entrypoint: child.entrypoint,
        gas_limit: child.gas_limit,
        calldata: child.calldata,
      },
    ],
  },
}).invocation;

it("decodes wallet arguments with the same codecs as generated bindings", () => {
  const decoded = createContractCallDecoder(spec)(root);
  expect(decoded?.methodName).toBe("execute");
  expect(decoded?.args).toEqual(
    DefaultWallet.v0_1.execute.decodeArgs(root.calldata),
  );
  expect(decodeDefaultWalletRequests(root)?.requestedCalls).toEqual([child]);
});

it("keeps unknown selectors separate from malformed known input", () => {
  expect(createContractCallDecoder(spec)(child)).toBeNull();
  expect(decodeDefaultWalletRequests(child)).toBeNull();
  expect(() =>
    createContractCallDecoder(spec)({
      ...root,
      calldata: calldata(new Uint8Array()),
    }),
  ).toThrow();
  expect(() =>
    decodeDefaultWalletRequests({
      ...root,
      calldata: calldata(new Uint8Array()),
    }),
  ).toThrow();
});

it("rejects ambiguous selectors and does not depend on subsequent spec mutation", () => {
  const copy = structuredClone(spec);
  const decode = createContractCallDecoder(copy);
  copy.interfaces.push(copy.interfaces[0]!);
  expect(() => createContractCallDecoder(copy)).toThrow(
    "Duplicate method selector",
  );
  expect(decode(root)?.methodName).toBe("execute");
});

it("decodes only the root wallet output as its declared vector", () => {
  const decoded = createContractCallDecoder(spec)(root)!;
  expect(decoded.method.decodeReturn(new Uint8Array([1, 1, 7]))).toEqual([
    new Uint8Array([7]),
  ]);
});
