import { expect, it } from "vitest";
import { ContractTypeKind, type ContractType } from "./spec.js";
import { spec } from "../contracts/default_wallet.js";
import { validateArtifactSpec } from "./specValidation.js";
import { preflightContractSpec } from "./specPreflight.js";
import { serialize } from "@thruputchain/protocol";
import { codec } from "@thruputchain/contract-spec";

it("bounds structural depth before named codec resolution", () => {
  const copy = structuredClone(spec);
  let type: ContractType = { v: ContractTypeKind.U64 };
  for (let index = 0; index < 150; index++)
    type = { v: ContractTypeKind.Option, option_inner: type };
  copy.interfaces[0]!.methods[0]!.return_type = type;
  expect(() =>
    preflightContractSpec(serialize(copy, codec.ContractSpec)),
  ).toThrow("nesting limit");
});

it("rejects unresolved method types even when their bytes are hash-bound", () => {
  const copy = structuredClone(spec);
  copy.type_defs = [];
  expect(() => validateArtifactSpec(copy)).toThrow();
});
