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
    // Independently reproduced with groundhog-signing's wallet_contract_hash
    // and derive_deploy_address for the Counter fixture rebuilt with SDK 0.38.0.
    expect(toHex(contractHash)).toBe(
      "d1dbe2f4094666dc14621ee75ee81b2874e5f929485af44c73384c5baeed4576",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "385756848395e4cf083e82e1a1198e5c7d6a65174ddc61c34f121b41b63a713b",
    );
  });
});
