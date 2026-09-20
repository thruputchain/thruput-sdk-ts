import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContractType,
  contractAddress,
  sha256Hash,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
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
    // and derive_deploy_address for the rebuilt scalar-topic Counter fixture.
    expect(toHex(contractHash)).toBe(
      "d7c9626f6ced5064e5e2ae6abfe342632458c2022f36209b8031c26d8844b194",
    );

    const address = deriveContractAddress(
      contractAddress(new Uint8Array(32).fill(0x71)),
      sha256Hash(new Uint8Array(32).fill(0x22)),
      contractHash,
    );
    expect(toHex(address)).toBe(
      "40cfad48dcc834987bb060fe7856fe75d1ca8c04a43d6eeea610f41cfede963b",
    );
  });
});
