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
      "7f48e0367507204bd87044f91b64ab13ec0d0577fe4d100e1ffca4a8fe068b1a",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "8858a11542a3ee66ddeeade4c3e4dda3817577b94b3abfca4114da871b125dd5",
    );
  });
});
