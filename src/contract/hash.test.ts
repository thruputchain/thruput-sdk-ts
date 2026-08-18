import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContractType,
  contractAddress,
  sha256Hash,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import { deriveContractAddress, hashContract } from "../index.js";

const counterWasm = readFileSync(
  new URL("../../examples/fixtures/counter.wasm", import.meta.url),
);

describe("hashContract", () => {
  it("matches the Counter deployment vector", () => {
    const contract = {
      contract_type: ContractType.kWasmi,
      wasmi_contract: { data: counterWasm },
    } as const;

    const contractHash = hashContract(contract);
    expect(toHex(contractHash)).toBe(
      "b0eebb0a4095def30cdddfa007e05ebffec56d22c66861cfa1eb5dd5960290b1",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "7a09b7f30a90b5d196bb8d8c644a7a91cd16f0237c715cd182f0fd3285d23027",
    );
  });
});
