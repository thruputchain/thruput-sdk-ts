import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  contractAddress,
  deserialize,
  gasAmount,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeKind,
  codec as contractSpecCodec,
  type ContractSpec,
} from "@groundhogchain/contract-spec";
import { fixedBytes } from "@groundhogchain/xdr";
import { deriveEntrypointID } from "../derivation/entrypointId.js";
import {
  SIGNED_OP_INTERFACE_VERSION,
  SignedOp,
  SignedOpError,
  signedOpTypeDefs,
} from "./interface.js";

// The finalized spec of `groundhog-signed-op-if`, built from its rv32 spec
// carrier. The hand-maintained descriptors in interface.ts must agree with it.
const specPath = fileURLToPath(
  new URL("../../specs/contracts/signed_op.spec.xdr", import.meta.url),
);
const spec: ContractSpec = deserialize(
  new Uint8Array(readFileSync(specPath)),
  contractSpecCodec.ContractSpec,
);
const iface = spec.interfaces[0]!;
const method = (name: string) => iface.methods.find((m) => m.name === name)!;

describe("SignedOp interface mirror", () => {
  it("mirrors the pinned interface version", () => {
    expect(spec.interfaces).toHaveLength(1);
    expect(iface.name).toBe("SignedOp");
    expect(iface.vers).toBe(SIGNED_OP_INTERFACE_VERSION);
  });

  it("mirrors the spec's type definitions", () => {
    expect(spec.type_defs).toEqual(signedOpTypeDefs);
  });

  it("mirrors the SignedOpError variants", () => {
    const enumDef = spec.type_defs.find(
      (def) => "enum_def" in def && def.enum_def.name === "SignedOpError",
    );
    expect(enumDef).toBeDefined();
    const variants = Object.fromEntries(
      ("enum_def" in enumDef! ? enumDef.enum_def.variants : []).map((v) => [
        v.name,
        v.value,
      ]),
    );
    expect(variants).toEqual(SignedOpError);
  });

  it("mirrors next_signed_op_nonce and derives its entrypoint from the spec", () => {
    const m = method("next_signed_op_nonce");
    expect(m.args.map((a) => a.name)).toEqual(["signer"]);
    expect(m.args[0]!.ty).toEqual({
      v: ContractTypeKind.Array,
      array: { element: { v: ContractTypeKind.U8 }, len: 32n },
    });
    expect(m.return_type).toEqual({ v: ContractTypeKind.U64 });
    expect(iface.throws).toHaveLength(1);
    expect(iface.throws[0]!.selector).toBe(0x65f3de61c8178163n);

    expect(toHex(SignedOp.nextSignedOpNonce.entrypoint)).toBe(
      toHex(deriveEntrypointID(iface.name, iface.vers, "next_signed_op_nonce")),
    );
    // Pinned against the Rust `contract_entrypoint_id` for the same triple.
    expect(toHex(SignedOp.nextSignedOpNonce.entrypoint)).toBe(
      "15796a0d138d2bd5",
    );
    expect(
      toHex(deriveEntrypointID(iface.name, iface.vers, "execute_signed_op")),
    ).toBe("c281dc2ffb5eeb1e");
  });

  it("encodes the signer as 32 raw bytes of calldata", () => {
    const signer = fixedBytes(new Uint8Array(32).fill(0xab), 32);
    const invocation = SignedOp.nextSignedOpNonce.invocation(
      contractAddress(new Uint8Array(32)),
      gasAmount(1n),
      { signer },
    );
    expect(toHex(invocation.calldata)).toBe("ab".repeat(32));
    expect(SignedOp.nextSignedOpNonce.decodeReturn(new Uint8Array([3]))).toBe(
      3n,
    );
  });
});
