import {
  codec,
  calldata,
  contractAddress,
  contractEntrypointID,
  deserialize,
  gasAmount,
  type Invocation,
} from "@groundhogchain/protocol";
import { describe, expect, it } from "vitest";
import { buildNamedCodecs } from "../contract/codegen.js";
import { decodeCalldata } from "../contract/encode.js";
import { spec as defaultWalletSpec } from "../contracts/default_wallet.js";
import { spec as devWalletSpec } from "../contracts/dev_wallet.js";
import {
  defaultWalletAdapter,
  devWalletAdapter,
  createDefaultWalletBatchInvocation,
} from "./invocationAdapter.js";

const accountAddress = contractAddress(new Uint8Array(32).fill(0x11));

function innerInvocation(): Invocation {
  return {
    invoked_address: contractAddress(new Uint8Array(32).fill(0x22)),
    entrypoint: contractEntrypointID(new Uint8Array(8).fill(0x33)),
    gas_limit: gasAmount(400n),
    calldata: calldata(new Uint8Array([1, 2, 3])),
  };
}

describe("wallet invocation adapters", () => {
  it("encodes ordered batch calls and snapshots their bytes", () => {
    const first = innerInvocation();
    const second = {
      ...innerInvocation(),
      calldata: calldata(new Uint8Array([9])),
    };
    const root = createDefaultWalletBatchInvocation(accountAddress, {
      invocations: [first, second],
      gasLimit: gasAmount(5_000n),
    });
    first.calldata.fill(8);
    second.calldata.fill(8);
    const decoded = decodeCalldata(
      defaultWalletSpec,
      "DefaultWallet",
      "execute",
      root.calldata,
      buildNamedCodecs(defaultWalletSpec.type_defs),
    );
    expect(decoded.calls).toMatchObject([
      { calldata: new Uint8Array([1, 2, 3]) },
      { calldata: new Uint8Array([9]) },
    ]);
    expect(root.gas_limit).toBe(5_000n);
  });

  it.each([0, 17])("rejects invalid batch size %s", (size) => {
    expect(() =>
      createDefaultWalletBatchInvocation(accountAddress, {
        invocations: Array.from({ length: size }, innerInvocation),
        gasLimit: gasAmount(5_000n),
      }),
    ).toThrow(RangeError);
  });
  it("maps one invocation to one DefaultWallet call", () => {
    const inner = innerInvocation();
    const root = defaultWalletAdapter.createRootInvocation(accountAddress, {
      invocation: inner,
      gasLimit: gasAmount(1_000n),
    });
    const decoded = decodeCalldata(
      defaultWalletSpec,
      "DefaultWallet",
      "execute",
      root.calldata,
      buildNamedCodecs(defaultWalletSpec.type_defs),
    );

    expect(root.invoked_address).toEqual(accountAddress);
    expect(root.gas_limit).toBe(1_000n);
    expect(decoded.calls).toEqual([
      {
        target: inner.invoked_address,
        entrypoint: inner.entrypoint,
        gas_limit: inner.gas_limit,
        calldata: inner.calldata,
      },
    ]);
  });

  it("serializes the complete invocation for DevWallet", () => {
    const inner = innerInvocation();
    const root = devWalletAdapter.createRootInvocation(accountAddress, {
      invocation: inner,
      gasLimit: gasAmount(1_000n),
    });
    const decoded = decodeCalldata(
      devWalletSpec,
      "DevWallet",
      "do_action",
      root.calldata,
      buildNamedCodecs(devWalletSpec.type_defs),
    );

    expect(
      deserialize(decoded.invocation_bytes as Uint8Array, codec.Invocation),
    ).toEqual(inner);
  });

  it("snapshots all mutable byte arrays", () => {
    const address = contractAddress(new Uint8Array(accountAddress));
    const inner = innerInvocation();
    const defaultRoot = defaultWalletAdapter.createRootInvocation(address, {
      invocation: inner,
      gasLimit: gasAmount(1_000n),
    });
    const devRoot = devWalletAdapter.createRootInvocation(address, {
      invocation: inner,
      gasLimit: gasAmount(1_000n),
    });

    address.fill(0xff);
    inner.invoked_address.fill(0xff);
    inner.entrypoint.fill(0xff);
    inner.calldata.fill(0xff);

    expect(defaultRoot.invoked_address).toEqual(
      contractAddress(new Uint8Array(32).fill(0x11)),
    );
    expect(devRoot.invoked_address).toEqual(
      contractAddress(new Uint8Array(32).fill(0x11)),
    );
    expect(defaultRoot.calldata).not.toContain(0xff);
    expect(devRoot.calldata).not.toContain(0xff);
  });
});
