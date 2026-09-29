import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserialize } from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeKind,
  codec as contractSpecCodec,
  type ContractSpec,
} from "@groundhogchain/contract-spec";
import { deriveEntrypointID } from "../derivation/entrypointId.js";
import {
  ERC20Permit,
  groundhog_erc20_permit_if,
  spec,
} from "./erc20_permit.js";

const { ERC20PermitError } = groundhog_erc20_permit_if.v0_1.error;

// The finalized spec of `groundhog-erc20-permit-if`, built from an rv32 spec
// carrier anchoring `ERC20Permit`: the input the binding was generated from.
const specPath = fileURLToPath(
  new URL("../../specs/contracts/erc20_permit.spec.xdr", import.meta.url),
);
const pinned: ContractSpec = deserialize(
  new Uint8Array(readFileSync(specPath)),
  contractSpecCodec.ContractSpec,
);

describe("ERC20Permit binding", () => {
  it("embeds the pinned interface spec", () => {
    expect(spec).toEqual(pinned);
    expect(spec.interfaces).toHaveLength(1);
    const iface = spec.interfaces[0]!;
    expect(iface.name).toBe("ERC20Permit");
    expect(iface.vers).toBe("0.1.41");
    expect([...iface.methods.map((m) => m.name)].sort()).toEqual([
      "clear_allowance_signed",
      "increase_allowance_signed",
      "transfer_from_signed",
    ]);
    // Signed operations fail either as the token's own errors or as the
    // permit's, so the interface declares both.
    const declared = iface.throws.map((t) =>
      t.ty.v === ContractTypeKind.Named ? t.ty.named.declared : t.ty.v,
    );
    expect([...declared].sort()).toEqual(["ERC20Error", "ERC20PermitError"]);
  });

  it("names every refusal", () => {
    expect(ERC20PermitError).toEqual({
      NotSpender: 1n,
      ExceedsGrant: 2n,
    });
  });

  it("derives every entrypoint from the interface", () => {
    const iface = spec.interfaces[0]!;
    const cases = [
      // Pinned against sha256("ERC20Permit::0.1::<method>")[0..8], the Rust
      // `contract_entrypoint_id` derivation, computed outside the generator.
      [
        ERC20Permit.v0_1.transferFromSigned,
        "transfer_from_signed",
        "87c3df36183d4aec",
      ],
      [
        ERC20Permit.v0_1.increaseAllowanceSigned,
        "increase_allowance_signed",
        "3a47108e9850272e",
      ],
      [
        ERC20Permit.v0_1.clearAllowanceSigned,
        "clear_allowance_signed",
        "30ee8dbff2e8e181",
      ],
    ] as const;
    for (const [method, name, expected] of cases) {
      expect(toHex(method.entrypoint)).toBe(
        toHex(deriveEntrypointID(iface.name, iface.vers, name)),
      );
      expect(toHex(method.entrypoint)).toBe(expected);
    }
  });
});
