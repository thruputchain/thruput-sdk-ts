import {
  CxsWriter,
  contractAddress,
  gasAmount,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import { fixedBytes } from "@groundhogchain/xdr";
import { describe, expect, it } from "vitest";
import { buildNamedCodecs } from "../contract/codegen.js";
import { decodeCalldata } from "../contract/encode.js";
import {
  DefaultWallet,
  default_wallet,
  spec as defaultWalletSpec,
} from "./default_wallet.js";
import { DevWallet } from "./dev_wallet.js";

const { WalletError } = default_wallet.v0_1.$interface;

describe("generated wallet contract bindings", () => {
  it("preserves the canonical entrypoint IDs", () => {
    const address = contractAddress(new Uint8Array(32));

    expect(
      toHex(
        DefaultWallet.v0_1.deploy.invocation(address, gasAmount(1n), {
          nonce: fixedBytes(new Uint8Array(32), 32),
          contractHash: fixedBytes(new Uint8Array(32), 32),
          amount: 0n,
          initializer: null,
        }).entrypoint,
      ),
    ).toBe("6be0cb0f6de0917a");
    expect(
      toHex(
        DefaultWallet.v0_1.execute.invocation(address, gasAmount(1n), {
          calls: [],
        }).entrypoint,
      ),
    ).toBe("c3edb11fdd6d5d58");
    expect(
      toHex(
        DevWallet.v0_1.doAction.invocation(address, gasAmount(1n), {
          invocationBytes: new Uint8Array(),
        }).entrypoint,
      ),
    ).toBe("a0fff94c64fbaf3c");
  });

  it("encodes DefaultWallet calls and decodes declared errors", () => {
    const address = contractAddress(new Uint8Array(32).fill(0x11));
    const invocation = DefaultWallet.v0_1.execute.invocation(
      address,
      gasAmount(10n),
      {
        calls: [
          {
            target: address,
            entrypoint: fixedBytes(new Uint8Array(8).fill(0x22), 8),
            gas_limit: 30n,
            calldata: new Uint8Array([1, 2, 3]),
          },
        ],
      },
    );
    const decoded = decodeCalldata(
      defaultWalletSpec,
      "DefaultWallet",
      "execute",
      invocation.calldata,
      buildNamedCodecs(defaultWalletSpec.type_defs),
    );

    expect(decoded.calls).toEqual([
      {
        target: address,
        entrypoint: new Uint8Array(8).fill(0x22),
        gas_limit: 30n,
        calldata: new Uint8Array([1, 2, 3]),
      },
    ]);

    const writer = new CxsWriter();
    writer.writeUint64(0x931d3297d37d1bdfn);
    writer.writeInt32(WalletError.EmptyCallList);
    expect(DefaultWallet.v0_1.execute.decodeException(writer.finish())).toEqual(
      {
        kind: "declared",
        name: "WalletError",
        variant: "EmptyCallList",
        selector: 0x931d3297d37d1bdfn,
        value: WalletError.EmptyCallList,
      },
    );
  });
});
