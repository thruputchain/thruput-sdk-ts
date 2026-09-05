import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CxsWriter,
  Uint64Codec,
  blockHeight,
  codec,
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
import { signedToken } from "../contract/signedToken.js";
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

  it("mirrors every method, and only those", () => {
    // Nonces are unordered, so the nonce view of earlier releases is gone:
    // nothing on chain needs reading before signing.
    expect(iface.methods.map((m) => m.name)).toEqual(["execute_signed_op"]);
    expect(Object.keys(SignedOp)).toEqual(["executeSignedOp"]);
    expect(iface.throws).toHaveLength(1);
    expect(iface.throws[0]!.selector).toBe(0x65f3de61c8178163n);
  });

  it("mirrors execute_signed_op, including its signed-token return", () => {
    const m = method("execute_signed_op");
    expect(m.args.map((a) => a.name)).toEqual(["op", "signature"]);
    expect(m.args[0]!.ty).toEqual({
      v: ContractTypeKind.Named,
      named: "Operation",
    });
    expect(m.args[1]!.ty).toEqual({
      v: ContractTypeKind.Array,
      array: { element: { v: ContractTypeKind.U8 }, len: 64n },
    });
    // One token, not a vector of them: the root of whatever the operation
    // authorizes.
    expect(m.return_type).toEqual({
      v: ContractTypeKind.SignedToken,
      signed_token_preimage: { preimage_type: null },
    });
    expect(toHex(SignedOp.executeSignedOp.entrypoint)).toBe(
      toHex(deriveEntrypointID(iface.name, iface.vers, "execute_signed_op")),
    );
    // Pinned against the Rust `contract_entrypoint_id` for the same triple;
    // unchanged from earlier 0.1.x releases, since only the major version
    // domain enters the derivation.
    expect(toHex(SignedOp.executeSignedOp.entrypoint)).toBe("c281dc2ffb5eeb1e");

    const signature = fixedBytes(new Uint8Array(64).fill(0xcd), 64);
    const invocation = SignedOp.executeSignedOp.invocation(
      contractAddress(new Uint8Array(32)),
      gasAmount(1n),
      {
        op: {
          block_expiry_height: 1_000n,
          nonce: 1n,
          body: new Uint8Array([0x2a]),
        },
        signature,
      },
    );
    // Operation: varint block_expiry_height, varint nonce (the chain's
    // Uniquifier order), length-prefixed body; then the 64 raw signature
    // bytes. No signer travels on the wire.
    const expected = new CxsWriter();
    codec.BlockHeight.encode(expected, blockHeight(1_000n));
    Uint64Codec.encode(expected, 1n);
    expected.writeVarOpaque(new Uint8Array([0x2a]), 4294967295);
    expected.writeFixedOpaque(signature, 64);
    expect(toHex(invocation.calldata)).toBe(toHex(expected.finish()));
    // The minted token comes back as a placeholder and no bytes at all.
    expect(SignedOp.executeSignedOp.decodeReturn(new Uint8Array())).toEqual(
      signedToken(),
    );
  });
});
