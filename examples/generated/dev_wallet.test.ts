import {
  CxsWriter,
  calldata,
  contractAddress,
  gasAmount,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import { describe, expect, it } from "vitest";
import { DevWallet } from "./dev_wallet.js";

const wallet = contractAddress(new Uint8Array(32));
const gasLimit = gasAmount(10_000_000n);

describe("DevWallet binding", () => {
  it("encodes deploy calldata with the pinned selector", () => {
    const nonce = new Uint8Array(32).fill(0x11);
    const contractHash = new Uint8Array(32).fill(0x22);
    const invocation = DevWallet.deploy(wallet, gasLimit, {
      nonce,
      contractHash,
    });

    const expected = new CxsWriter();
    expected.writeFixedOpaque(nonce, 32);
    expected.writeFixedOpaque(contractHash, 32);

    expect(toHex(invocation.entrypoint)).toBe("f969542572bd6860");
    expect(invocation.calldata).toEqual(calldata(expected.finish()));
  });

  it("encodes doAction calldata with the pinned selector", () => {
    const invocationBytes = new Uint8Array([1, 2, 3, 4]);
    const invocation = DevWallet.doAction(wallet, gasLimit, {
      invocationBytes,
    });

    const expected = new CxsWriter();
    expected.writeVarOpaque(invocationBytes, 0xffffffff);

    expect(toHex(invocation.entrypoint)).toBe("a0fff94c64fbaf3c");
    expect(invocation.calldata).toEqual(calldata(expected.finish()));
  });
});
