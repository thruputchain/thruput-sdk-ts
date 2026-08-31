/**
 * Cross-SDK signed-operation preimages.
 *
 * Replays the vectors emitted by the Rust `groundhog-test-vectors signed-op` so
 * the two implementations cannot drift apart silently. Each vector carries
 * every intermediate stage, so a failure names the stage that drifted rather
 * than just reporting a different digest.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromHex, toHex } from "@groundhogchain/protocol";
import type { ContractAddress, NetworkHash } from "@groundhogchain/protocol";
import { operationTypeId } from "../derivation/entrypointId.js";
import {
  encodeSignedOperation,
  signedOperationId,
  signedOperationPreimage,
  type SignedOperation,
} from "./preimage.js";

interface Vector {
  domain_separator: string;
  domain_separator_cxs_hex: string;
  interface: string | null;
  version_str: string;
  operation: string;
  type_id_hex: string;
  network_hex: string;
  verifying_contract_hex: string;
  nonce: string;
  valid_until: string;
  body_hex: string;
  preimage_cxs_hex: string;
  signed_message_hex: string;
  expected_digest_hex: string;
}

interface VectorFile {
  version: number;
  category: string;
  vectors: Vector[];
}

// Generated, not committed: CI regenerates from the published
// groundhog-test-vectors crate; run scripts/regen-test-vectors.sh locally.
const vectorsPath = fileURLToPath(
  new URL("../../specs/test-vectors/signed-op.json", import.meta.url),
);
const haveVectors = existsSync(vectorsPath);
const vectorFile: VectorFile = haveVectors
  ? (JSON.parse(readFileSync(vectorsPath, "utf-8")) as VectorFile)
  : { version: 0, category: "", vectors: [] };
const vectors: Vector[] = vectorFile.vectors;

function operationOf(v: Vector): SignedOperation {
  return {
    network: fromHex(v.network_hex) as NetworkHash,
    verifyingContract: fromHex(v.verifying_contract_hex) as ContractAddress,
    typeId: BigInt(`0x${v.type_id_hex}`),
    nonce: BigInt(v.nonce),
    validUntil: BigInt(v.valid_until),
    body: fromHex(v.body_hex),
  };
}

const label = (v: Vector) => `${v.operation}/nonce=${v.nonce}`;

describe.skipIf(!haveVectors)("cross-SDK: signed operations", () => {
  it("loads the expected vector category", () => {
    expect(vectorFile.category).toBe("signed_op");
    expect(vectors.length).toBeGreaterThan(0);
  });

  it.each(vectors.map((v) => [label(v), v] as const))(
    "%s: operation type ID matches type_id_hex",
    (_label, v) => {
      const id = operationTypeId(v.interface, v.version_str, v.operation);
      expect(id.toString(16).padStart(16, "0")).toBe(v.type_id_hex);
    },
  );

  it.each(vectors.map((v) => [label(v), v] as const))(
    "%s: struct encoding matches preimage_cxs_hex",
    (_label, v) => {
      expect(toHex(encodeSignedOperation(operationOf(v)))).toBe(
        v.preimage_cxs_hex,
      );
    },
  );

  it.each(vectors.map((v) => [label(v), v] as const))(
    "%s: signed message matches signed_message_hex",
    (_label, v) => {
      expect(toHex(signedOperationPreimage(operationOf(v)))).toBe(
        v.signed_message_hex,
      );
    },
  );

  it.each(vectors.map((v) => [label(v), v] as const))(
    "%s: identifier matches expected_digest_hex",
    (_label, v) => {
      expect(toHex(signedOperationId(operationOf(v)))).toBe(
        v.expected_digest_hex,
      );
    },
  );

  it("separator prefix is the versioned SignedOp domain", () => {
    for (const v of vectors) {
      expect(v.domain_separator).toBe("SignedOp::1");
      expect(v.signed_message_hex.startsWith(v.domain_separator_cxs_hex)).toBe(
        true,
      );
    }
  });

  /// The vector set must contain two operations that differ only by name, or
  /// it would pass for an implementation with no type binding at all.
  it("pins that the operation name changes the message", () => {
    const transfer = vectors.find(
      (v) => v.operation === "transfer" && v.nonce === "1",
    );
    const approve = vectors.find((v) => v.operation === "approve");
    expect(transfer).toBeDefined();
    expect(approve).toBeDefined();
    expect(transfer!.body_hex).toBe(approve!.body_hex);
    expect(transfer!.expected_digest_hex).not.toBe(
      approve!.expected_digest_hex,
    );
  });
});
