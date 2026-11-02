import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  codec,
  ContractType,
  serialize,
  sha256Hash,
} from "@thruputchain/protocol";
import { readContractArtifactSpec } from "./artifact.js";

const spec = new Uint8Array(
  readFileSync(
    new URL("../../specs/contracts/erc20.spec.xdr", import.meta.url),
  ),
);
function artifact(schema = 1, metadata = spec) {
  const bytes = new Uint8Array(140 + metadata.length);
  bytes.set(new TextEncoder().encode("GHRV32A1"));
  const header = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [8, 6],
    [12, 136],
    [52, 4],
    [128, schema],
    [132, metadata.length],
  ] as const)
    header.setUint32(offset, value, true);
  bytes.set(metadata, 140);
  return bytes;
}
function inspect(payload: Uint8Array) {
  const bytes = serialize(
    { contract_type: ContractType.kRv32, rv32_contract: { data: payload } },
    codec.Contract,
  );
  return readContractArtifactSpec(bytes, sha256Hash(sha256(bytes)));
}

describe("authenticated embedded specs", () => {
  it("decodes the existing canonical spec using shared codecs", () => {
    const result = inspect(artifact());
    expect(result.kind).toBe("spec");
    if (result.kind === "spec") expect(result.bytes).toEqual(spec);
  });
  it("preserves unsupported schemas and distinguishes absent specs", () => {
    expect(inspect(artifact(2))).toEqual({
      kind: "unsupportedSchema",
      schemaVersion: 2,
      bytes: spec,
    });
    expect(inspect(artifact(0, new Uint8Array()))).toEqual({ kind: "absent" });
    const old = artifact();
    new DataView(old.buffer).setUint32(8, 5, true);
    expect(inspect(old)).toEqual({
      kind: "unsupportedFormat",
      formatVersion: 5,
    });
  });
  it("rejects malformed section bounds even when their hash matches", () => {
    expect(() => inspect(artifact().slice(0, -1))).toThrow("layout");
    expect(() => inspect(artifact(0))).toThrow("layout");
    expect(() => inspect(artifact(1, new Uint8Array()))).toThrow("layout");
    const overflow = artifact();
    new DataView(overflow.buffer).setUint32(52, 0xffffffff, true);
    expect(() => inspect(overflow)).toThrow("layout");
  });
  it("rejects forged identity and noncanonical full XDR", () => {
    const bytes = serialize(
      {
        contract_type: ContractType.kRv32,
        rv32_contract: { data: artifact() },
      },
      codec.Contract,
    );
    expect(() =>
      readContractArtifactSpec(bytes, sha256Hash(new Uint8Array(32))),
    ).toThrow("hash mismatch");
    const trailing = new Uint8Array(bytes.length + 4);
    trailing.set(bytes);
    expect(() =>
      readContractArtifactSpec(trailing, sha256Hash(sha256(trailing))),
    ).toThrow();
  });
  it("does not classify mock code as a native contract", () => {
    const bytes = serialize(
      { contract_type: ContractType.kMockTest, mock_contract_id: 0n },
      codec.Contract,
    );
    expect(readContractArtifactSpec(bytes, sha256Hash(sha256(bytes)))).toEqual({
      kind: "unsupportedContract",
      contractType: 2,
    });
  });
});
