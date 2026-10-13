import { describe, expect, it } from "vitest";
import { contractAddress, gasAmount } from "@thruputchain/protocol";
import { decodeCalldata } from "../contract/encode.js";
import { buildNamedCodecs } from "../contract/codegen.js";
import {
  RecursiveTypeContract,
  spec,
  type recursive_type,
} from "./recursive_type.js";

type Tree = recursive_type.v0_4.implementation.Tree;
type Forest = recursive_type.v0_4.implementation.Forest;

const contract = contractAddress(new Uint8Array(32).fill(0x33));
const gas = gasAmount(1_000_000n);
const namedCodecs = buildNamedCodecs(spec.type_defs);

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

    const invocation = RecursiveTypeContract.v0_1.depth.invocation(
      contract,
      gas,
      {
        tree,
      },
    );

    expect(invocation.invoked_address).toEqual(contract);
    expect(invocation.entrypoint.length).toBe(8);

    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "depth",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.tree).toEqual(tree);
  });

  it("depth() encodes a leaf node", () => {
    const leaf: Tree = { value: 42n, left: null, right: null };

    const invocation = RecursiveTypeContract.v0_1.depth.invocation(
      contract,
      gas,
      {
        tree: leaf,
      },
    );
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "depth",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.tree).toEqual(leaf);
  });

  it("forest_depth() encodes a recursive Forest", () => {
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

    const invocation = RecursiveTypeContract.v0_1.forestDepth.invocation(
      contract,
      gas,
      { forest },
    );
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "forest_depth",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.forest).toEqual(forest);
  });

  it("forest_depth() encodes an empty Forest", () => {
    const forest: Forest = { trees: [], label: 0n };

    const invocation = RecursiveTypeContract.v0_1.forestDepth.invocation(
      contract,
      gas,
      { forest },
    );
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "forest_depth",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.forest).toEqual(forest);
  });

  it("unbox() encodes a simple u32 arg", () => {
    const invocation = RecursiveTypeContract.v0_1.unbox.invocation(
      contract,
      gas,
      {
        val: 99n,
      },
    );
    const decoded = decodeCalldata(
      spec,
      "RecursiveTypeContract",
      "unbox",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.val).toBe(99n);
  });
});
