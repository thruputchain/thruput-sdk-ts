import { describe, expect, it } from "vitest";
import {
  contractAddress,
  deserializeCxs,
  codec,
} from "@groundhogchain/protocol";
import type { ContractSpec } from "./spec.js";
import { encodeCalldata } from "./encode.js";

const erc20Spec: ContractSpec = {
  format: "gh_contract_spec_v1",
  interfaces: [
    {
      name: "ERC20",
      version: "0.1.0",
      throws: [
        {
          selector: "0xb19947acb2fa14ff",
          type: { kind: "named", name: "ERC20Error" },
        },
      ],
      methods: [
        {
          name: "transfer",
          args: [
            { name: "to", ty: { kind: "address" } },
            { name: "amount", ty: { kind: "u128" } },
          ],
          return_type: { kind: "void" },
        },
        {
          name: "get_balance",
          args: [],
          return_type: { kind: "u128" },
        },
        {
          name: "get_balance_of",
          args: [{ name: "addr", ty: { kind: "address" } }],
          return_type: { kind: "u128" },
        },
      ],
    },
  ],
  type_defs: [
    {
      kind: "enum",
      name: "ERC20Error",
      variants: [
        { name: "AlreadyInitialized", value: 1 },
        { name: "MustBeContractOwner", value: 2 },
        { name: "TooLarge", value: 3 },
        { name: "Internal", value: 100 },
      ],
    },
  ],
};

describe("encodeCalldata", () => {
  it("encodes transfer(address, u128)", () => {
    const to = contractAddress(new Uint8Array(32).fill(0xab));
    const amount = 1000n;

    const data = encodeCalldata(erc20Spec, "ERC20", "transfer", [to, amount]);

    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBeGreaterThan(0);
  });

  it("encodes get_balance() with no args", () => {
    const data = encodeCalldata(erc20Spec, "ERC20", "get_balance", []);

    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(0);
  });

  it("throws on wrong arg count", () => {
    expect(() => encodeCalldata(erc20Spec, "ERC20", "transfer", [])).toThrow(
      'Expected 2 args for "transfer", got 0',
    );
  });

  it("throws on unknown method", () => {
    expect(() => encodeCalldata(erc20Spec, "ERC20", "nonexistent", [])).toThrow(
      'Method "nonexistent" not found',
    );
  });

  it("throws on unknown interface", () => {
    expect(() => encodeCalldata(erc20Spec, "Unknown", "transfer", [])).toThrow(
      'Interface "Unknown" not found',
    );
  });
});
