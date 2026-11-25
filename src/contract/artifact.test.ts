import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { XdrWriter } from "@thruputchain/xdr";
import {
  codec,
  ContractType,
  serialize,
  deserialize,
  sha256Hash,
} from "@thruputchain/protocol";
import { codec as specCodec } from "@thruputchain/contract-spec";
import { readContractArtifactSpec } from "./artifact.js";

const spec = new Uint8Array(
  readFileSync(
    new URL("../../specs/contracts/erc20.spec.xdr", import.meta.url),
  ),
);
// A v7 header is 120 bytes, with the code size at 44 and the initial-memory
// size at 48.
const headerBytes = 120;
const codeSizeOffset = 44;
function artifact(schema = 1, metadata = spec) {
  const body = new XdrWriter();
  body.writeUint32(BigInt(schema));
  body.writeVarOpaque(metadata, metadata.length);
  return withExtensions([{ kind: 1, body: body.finish() }]);
}
function withExtensions(extensions: { kind: number; body: Uint8Array }[]) {
  const writer = new XdrWriter();
  writer.writeUint32(BigInt(extensions.length));
  for (const { kind, body } of extensions) {
    writer.writeUint32(BigInt(kind));
    writer.writeVarOpaque(body, body.length);
  }
  return withRawExtensions(writer.finish());
}
// Four bytes of code, no initial memory, then the raw extension list.
function withRawExtensions(extensions: Uint8Array) {
  const bytes = new Uint8Array(headerBytes + 4 + extensions.length);
  bytes.set(new TextEncoder().encode("GHRV32A1"));
  const header = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [8, 7],
    [12, headerBytes],
    [codeSizeOffset, 4],
  ] as const)
    header.setUint32(offset, value, true);
  bytes.set(extensions, headerBytes + 4);
  return bytes;
}
function words(...values: number[]) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value));
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
    expect(result).toEqual({
      kind: "spec",
      schemaVersion: 1,
      spec: deserialize(spec, specCodec.ContractSpec),
    });
  });
  it("preserves unsupported schemas and distinguishes absent specs", () => {
    expect(inspect(artifact(2))).toEqual({
      kind: "unsupportedSchema",
      schemaVersion: 2,
      bytes: spec,
    });
    expect(inspect(withExtensions([]))).toEqual({ kind: "absent" });
    expect(inspect(artifact(0, new Uint8Array()))).toEqual({
      kind: "unsupportedSchema",
      schemaVersion: 0,
      bytes: new Uint8Array(),
    });
  });
  it("reads v5, which ends after initial memory, as having no spec", () => {
    // A 128-byte v5 header with 4 bytes of code at offset 52, then the code.
    const v5 = new Uint8Array(132);
    v5.set(new TextEncoder().encode("GHRV32A1"));
    const header = new DataView(v5.buffer);
    for (const [offset, value] of [
      [8, 5],
      [12, 128],
      [52, 4],
    ] as const)
      header.setUint32(offset, value, true);
    expect(inspect(v5)).toEqual({ kind: "absent" });
    const trailing = new Uint8Array(v5.length + 4);
    trailing.set(v5);
    expect(() => inspect(trailing)).toThrow("layout");
  });
  it("returns an unknown format as unsupported", () => {
    const bytes = artifact();
    new DataView(bytes.buffer).setUint32(8, 8, true);
    expect(inspect(bytes)).toEqual({
      kind: "unsupportedFormat",
      formatVersion: 8,
    });
  });
  it("rejects a v7 header that declares the 128 bytes of v6", () => {
    const bytes = artifact();
    new DataView(bytes.buffer).setUint32(12, 128, true);
    expect(() => inspect(bytes)).toThrow("header size");
  });
  it("rejects malformed section bounds even when their hash matches", () => {
    expect(() => inspect(artifact().slice(0, -1))).toThrow();
    expect(() => inspect(artifact(1, new Uint8Array()))).toThrow();
    // Overflow the code size, then the initial-memory size that follows it.
    for (const offset of [codeSizeOffset, codeSizeOffset + 4]) {
      const overflow = artifact();
      new DataView(overflow.buffer).setUint32(offset, 0xffffffff, true);
      expect(() => inspect(overflow)).toThrow("layout");
    }
  });
  it("skips opaque unknown kinds but validates the entire list", () => {
    const body = words(99, 0);
    expect(
      inspect(withExtensions([{ kind: 7, body: new Uint8Array([255]) }])),
    ).toEqual({ kind: "absent" });
    expect(
      inspect(
        withExtensions([
          { kind: 1, body },
          { kind: 0xffffffff, body: new Uint8Array([255]) },
        ]),
      ),
    ).toEqual({
      kind: "unsupportedSchema",
      schemaVersion: 99,
      bytes: new Uint8Array(),
    });
    expect(() =>
      inspect(
        withExtensions([
          { kind: 1, body },
          { kind: 1, body },
        ]),
      ),
    ).toThrow("ascending");
  });
  it.each([
    ["missing list", new Uint8Array()],
    ["zero kind", words(1, 0, 0)],
    ["duplicate", words(2, 7, 0, 7, 0)],
    ["descending", words(2, 8, 0, 7, 0)],
    ["outer padding", words(1, 7, 1, 0xaa000001)],
    ["trailing bytes", words(1, 7, 0, 0)],
    ["huge count", words(0xffffffff)],
    ["huge body", words(1, 7, 0xffffffff)],
  ])("rejects malformed extension framing: %s", (_, raw) => {
    expect(() => inspect(withRawExtensions(raw))).toThrow(
      expect.objectContaining({ code: "contractVerificationFailed" }),
    );
  });
  it.each([
    ["truncation", words(1)],
    ["inner padding", words(1, 1, 0xaa000001)],
    ["inner trailing bytes", words(1, 0, 0)],
  ])("rejects malformed spec bodies: %s", (_, body) => {
    expect(() => inspect(withExtensions([{ kind: 1, body }]))).toThrow(
      expect.objectContaining({ code: "contractVerificationFailed" }),
    );
  });
  it("rejects every truncation of a spec-bearing artifact", () => {
    const bytes = artifact();
    for (let end = 0; end < bytes.length; end++)
      expect(() => inspect(bytes.subarray(0, end))).toThrow(
        expect.objectContaining({ code: "contractVerificationFailed" }),
      );
  });
  it("reads the previous format, v6, from the fixture regenerated with tools #706", () => {
    const bytes = new Uint8Array(
      readFileSync(
        new URL(
          "../../specs/contracts/rv32-v6-extensions.rv32a",
          import.meta.url,
        ),
      ),
    );
    expect(inspect(bytes)).toEqual({ kind: "absent" });
  });
  it("reads the spec from the v7 Counter artifact built by CLI 0.47.0", () => {
    const bytes = new Uint8Array(
      readFileSync(
        new URL("../../examples/fixtures/counter.rv32a", import.meta.url),
      ),
    );
    const counterSpec = new Uint8Array(
      readFileSync(
        new URL("../../specs/contracts/counter.spec.xdr", import.meta.url),
      ),
    );
    expect(inspect(bytes)).toEqual({
      kind: "spec",
      schemaVersion: 1,
      spec: deserialize(counterSpec, specCodec.ContractSpec),
    });
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
    ).toThrow(expect.objectContaining({ code: "contractVerificationFailed" }));
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
