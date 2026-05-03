import { describe, expect, it } from "vitest";
import { contractAddress, gasAmount } from "@groundhogchain/protocol";
import { decodeCalldata } from "../contract/encode.js";
import {
  depth,
  forestDepth,
  unbox,
  spec,
  type Tree,
  type Forest,
} from "./recursive_type.js";

const contract = contractAddress(new Uint8Array(32).fill(0x33));
const gas = gasAmount(1_000_000n);

describe("generated RecursiveTypeContract bindings", () => {
  it("depth() encodes a nested Tree and decodes back", () => {
    const tree: Tree = {
      value: 1n,
      left: {
        value: 2n,
        left: { value: 4n, left: null, right: null },
        right: null,
      },
      right: {
        value: 3n,
        left: null,
        right: { value: 5n, left: null, right: null },
      },
    };

    const invocation = depth(contract, gas, { tree });

    expect(invocation.invoked_address).toEqual(contract);
    expect(invocation.entrypoint.length).toBe(8);

    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "depth",
      invocation.calldata,
    );
    expect(decoded.tree).toEqual(tree);
  });

  it("depth() encodes a leaf node", () => {
    const leaf: Tree = { value: 42n, left: null, right: null };

    const invocation = depth(contract, gas, { tree: leaf });
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "depth",
      invocation.calldata,
    );
    expect(decoded.tree).toEqual(leaf);
  });

  it("forestDepth() encodes a recursive Forest", () => {
    const forest: Forest = {
      trees: [
        { trees: [], label: 10n },
        {
          trees: [{ trees: [], label: 30n }],
          label: 20n,
        },
      ],
      label: 1n,
    };

    const invocation = forestDepth(contract, gas, { forest });
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "forest_depth",
      invocation.calldata,
    );
    expect(decoded.forest).toEqual(forest);
  });

  it("forestDepth() encodes an empty Forest", () => {
    const forest: Forest = { trees: [], label: 0n };

    const invocation = forestDepth(contract, gas, { forest });
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "forest_depth",
      invocation.calldata,
    );
    expect(decoded.forest).toEqual(forest);
  });

  it("unbox() encodes a simple u32 arg", () => {
    const invocation = unbox(contract, gas, { val: 99n });
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "unbox",
      invocation.calldata,
    );
    expect(decoded.val).toBe(99n);
  });
});
