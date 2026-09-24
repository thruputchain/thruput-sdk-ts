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
  codec as contractSpecCodec,
  type ContractSpec,
} from "@groundhogchain/contract-spec";
import { fixedBytes } from "@groundhogchain/xdr";
import { signedToken } from "../contract/signedToken.js";
import { deriveEntrypointID } from "../derivation/entrypointId.js";
import { SignedOp, SignedOpError, spec } from "./signed_op.js";

// The finalized spec of `groundhog-signed-op-if`, built from its rv32 spec
// carrier: the input the binding was generated from.
const specPath = fileURLToPath(
  new URL("../../specs/contracts/signed_op.spec.xdr", import.meta.url),
);
const pinned: ContractSpec = deserialize(
  new Uint8Array(readFileSync(specPath)),
  contractSpecCodec.ContractSpec,
);

describe("SignedOp binding", () => {
  it("embeds the pinned interface spec", () => {
    expect(spec).toEqual(pinned);
    expect(spec.interfaces).toHaveLength(1);
    expect(spec.interfaces[0]!.name).toBe("SignedOp");
    expect(spec.interfaces[0]!.vers).toBe("0.1.36");
    // Nonces are unordered, so the nonce view of earlier releases is gone:
    // nothing on chain needs reading before signing.
    expect(spec.interfaces[0]!.methods.map((m) => m.name)).toEqual([
      "execute_signed_op",
    ]);
  });

  it("names every refusal", () => {
    expect(SignedOpError).toEqual({
      InvalidSignature: 1n,
      Expired: 2n,
      AlreadyConsumed: 3n,
      MalformedBody: 4n,
      NotYetExpired: 5n,
    });
  });

  it("derives execute_signed_op's entrypoint from the interface", () => {
    const iface = spec.interfaces[0]!;
    expect(toHex(SignedOp.executeSignedOp.entrypoint)).toBe(
      toHex(deriveEntrypointID(iface.name, iface.vers, "execute_signed_op")),
    );
    // Pinned against the Rust `contract_entrypoint_id` for the same triple;
    // unchanged across 0.1.x releases, since only the major-version domain
    // enters the derivation.
    expect(toHex(SignedOp.executeSignedOp.entrypoint)).toBe("c281dc2ffb5eeb1e");
  });

  it("encodes the operation as the chain's Uniquifier then the body, and returns one token", () => {
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
