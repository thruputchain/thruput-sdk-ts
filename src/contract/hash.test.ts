import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContractType,
  contractAddress,
  sha256Hash,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import { deriveContractAddress, hashContract } from "../index.js";

const counterArtifact = readFileSync(
  new URL("../../examples/fixtures/counter.rv32a", import.meta.url),
);

describe("hashContract", () => {
  it("matches the Counter deployment vector", () => {
    const contract = {
      contract_type: ContractType.kRv32,
      rv32_contract: { data: counterArtifact },
    } as const;

    const contractHash = hashContract(contract);
    expect(toHex(contractHash)).toBe(
      "4eb0b279d37ff9ff0d73a94ec26102cc5d0b9ea7f726ba63bdf123a876d2c2ef",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "54d18e4ee2759eb1979b9d728de39de2556898455d2c8af8bfbf8920fd041604",
    );
  });
});
