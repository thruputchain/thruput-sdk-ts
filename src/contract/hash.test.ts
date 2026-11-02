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
    // Independently checked with Python struct.pack(">II", 3, len(artifact)),
    // XDR zero padding, and hashlib over the deployed v6 Counter fixture.
    expect(toHex(contractHash)).toBe(
      "25a681eb2f6b9b65ce00ff9db681c1149a42c264a5649efb09801e38b06ae25b",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "9e7c661932b3793983aea6c27bd98602b1bdad3e4f3370b7f0fe942800859080",
    );
  });
});
