import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codec, ContractTypeKind } from "@thruputchain/contract-spec";
import { deserialize, serialize } from "@thruputchain/protocol";
import {
  contractSpecCodecLimits,
  preflightContractSpec,
} from "./specPreflight.js";
import { ContractDecodeError } from "./errors.js";

// Same wire fixtures as tools' contract_spec/bounded/tests.rs.
function nestedReturn(depth: number, kind: number): Uint8Array {
  const words = [1, 0, 0, 0, 1, 0, 0];
  for (let i = 1; i < depth; i++) {
    words.push(kind);
    if (
      kind === ContractTypeKind.Tuple ||
      kind === ContractTypeKind.SignedToken
    )
      words.push(1);
  }
  words.push(ContractTypeKind.U8);
  if (kind === ContractTypeKind.Array || kind === ContractTypeKind.Vector)
    for (let i = 1; i < depth; i++) words.push(32);
  words.push(0, 0, 0);
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word));
  return bytes;
}

it("accepts depth 64 and rejects 65 for every recursive constructor", () => {
  for (const kind of [
    ContractTypeKind.Option,
    ContractTypeKind.Array,
    ContractTypeKind.Vector,
    ContractTypeKind.Tuple,
    ContractTypeKind.SignedToken,
  ]) {
    const bytes = nestedReturn(64, kind);
    expect(() => preflightContractSpec(bytes)).not.toThrow();
    const spec = deserialize(
      bytes,
      codec.ContractSpec,
      contractSpecCodecLimits,
    );
    expect(
      serialize(spec, codec.ContractSpec, contractSpecCodecLimits),
    ).toEqual(bytes);
    expect(() => preflightContractSpec(nestedReturn(65, kind))).toThrow(
      "nesting limit",
    );
  }
});

it("rejects deep and impossible collections with a typed error before generated decoding", () => {
  expect(() =>
    preflightContractSpec(nestedReturn(20_000, ContractTypeKind.Option)),
  ).toThrow(ContractDecodeError);
  expect(() =>
    preflightContractSpec(new Uint8Array([255, 255, 255, 255])),
  ).toThrow(ContractDecodeError);
});

it("round-trips a spec near the schema work limit with the shared codec limits", () => {
  // One interface, one method, one tuple node, and two units per tuple element.
  const words = [1, 0, 0, 0, 1, 0, 0, ContractTypeKind.Tuple, 49_998];
  for (let i = 0; i < 49_998; i++) words.push(ContractTypeKind.U8);
  words.push(0, 0, 0);
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word));
  preflightContractSpec(bytes);
  const spec = deserialize(bytes, codec.ContractSpec, contractSpecCodecLimits);
  expect(serialize(spec, codec.ContractSpec, contractSpecCodecLimits)).toEqual(
    bytes,
  );
});

it("accepts standard specs and rejects every truncated prefix", () => {
  const bytes = new Uint8Array(
    readFileSync(
      new URL("../../specs/contracts/erc20.spec.xdr", import.meta.url),
    ),
  );
  expect(() => preflightContractSpec(bytes)).not.toThrow();
  for (let end = 0; end < bytes.length; end++)
    expect(() => preflightContractSpec(bytes.subarray(0, end))).toThrow(
      ContractDecodeError,
    );
});
