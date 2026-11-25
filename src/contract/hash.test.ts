import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContractType,
  contractAddress,
  sha256Hash,
} from "@thruputchain/protocol";
import { toHex } from "@thruputchain/protocol/utils";
import { deriveContractAddress, hashContract } from "./index.js";

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
    // Independently checked with plain SHA-256 over the big-endian words
    // (3, len(artifact)), the deployed v7 Counter fixture, and XDR zero padding.
    expect(toHex(contractHash)).toBe(
      "0799533b00916a5b7b32823664f15ed6123c4a4f787ca2b5bb822816a4a39ff0",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    // Independently checked as SHA-256 over deployer, nonce and contract hash.
    expect(toHex(address)).toBe(
      "2c671399c80ef070eee797fe2f93e9ac85e35bdb199972f9142e6108e8fcf2e0",
    );
  });
});
