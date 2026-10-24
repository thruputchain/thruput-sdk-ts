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
    // Independently reproduced with thruput-signing 0.39.0's wallet_contract_hash
    // and derive_deploy_address for the Counter fixture rebuilt with SDK 0.57.0.
    expect(toHex(contractHash)).toBe(
      "383645579d65975cacc8852dcead276808d0ee38a2e36de73a9368bc25ed6b01",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "23832469481e7ac462a7a37ad9cced56e4ab40446ba611e53be77913b93097c5",
    );
  });
});
