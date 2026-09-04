import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  contractAddress,
  gasAmount,
  Uint32Codec,
  CxsWriter,
} from "@groundhogchain/protocol";
import { fromHex, toHex } from "@groundhogchain/protocol/utils";
import { ContractTypeKind } from "@groundhogchain/contract-spec";
import {
  RecursiveTypeContract,
  type Tree,
} from "../contracts/recursive_type.js";
import { createContractCodec, createContractCodecContext } from "./codec.js";

interface VectorFile {
  version: number;
  category: string;
  scalarU8: { value: string; cxsHex: string }[];
  scalarU256: { value: string; cxsHex: string }[];
  scalarI256: { value: string; cxsHex: string }[];
  fixedU8: { valueHex: string; cxsHex: string };
  variableU8: { valueHex: string; cxsHex: string };
  recursiveTree: {
    value: {
      value: string;
      left: { value: string; left: null; right: null };
      right: null;
    };
    cxsHex: string;
  };
}

const vectorsPath = fileURLToPath(
  new URL("../../specs/test-vectors/contract-cxs.json", import.meta.url),
);
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as VectorFile;

describe("Rust contract CXS vectors", () => {
  const context = createContractCodecContext([]);

  it("loads the expected fixture version and category", () => {
    expect(vectors.version).toBe(1);
    expect(vectors.category).toBe("contract_cxs");
  });

  it.each(vectors.scalarU8)("encodes scalar U8 $value", ({ value, cxsHex }) => {
    const codec = createContractCodec<bigint>(context, {
      v: ContractTypeKind.U8,
    });

    expect(toHex(codec.encode(BigInt(value)))).toBe(cxsHex);
  });

  it.each([
    ["U256", ContractTypeKind.U256, vectors.scalarU256],
    ["I256", ContractTypeKind.I256, vectors.scalarI256],
  ] as const)("replays fixed-width %s vectors", (_name, kind, cases) => {
    const codec = createContractCodec<bigint>(context, { v: kind });

    for (const { value, cxsHex } of cases) {
      const encoded = fromHex(cxsHex);
      expect(codec.encode(BigInt(value))).toEqual(encoded);
      expect(codec.decode(encoded)).toBe(BigInt(value));
    }
  });

  it("rejects a decoded scalar U8 above 255", () => {
    const codec = createContractCodec<bigint>(context, {
      v: ContractTypeKind.U8,
    });
    const writer = new CxsWriter();
    Uint32Codec.encode(writer, 256n);

    expect(() => codec.decode(writer.finish())).toThrow("uint8 overflow: 256");
  });

  it("encodes fixed and variable U8 containers", () => {
    const fixed = createContractCodec<Uint8Array>(context, {
      v: ContractTypeKind.Array,
      array: { element: { v: ContractTypeKind.U8 }, len: 4n },
    });
    const variable = createContractCodec<Uint8Array>(context, {
      v: ContractTypeKind.Vector,
      vector: { element: { v: ContractTypeKind.U8 }, max_len: 4n },
    });

    expect(toHex(fixed.encode(fromHex(vectors.fixedU8.valueHex)))).toBe(
      vectors.fixedU8.cxsHex,
    );
    expect(toHex(variable.encode(fromHex(vectors.variableU8.valueHex)))).toBe(
      vectors.variableU8.cxsHex,
    );
  });

  it("encodes a recursive named struct", () => {
    const tree: Tree = {
      value: BigInt(vectors.recursiveTree.value.value),
      left: {
        value: BigInt(vectors.recursiveTree.value.left.value),
        left: null,
        right: null,
      },
      right: null,
    };
    const invocation = RecursiveTypeContract.depth.invocation(
      contractAddress(new Uint8Array(32)),
      gasAmount(1n),
      { tree },
    );

    expect(toHex(invocation.calldata)).toBe(vectors.recursiveTree.cxsHex);
  });
});
