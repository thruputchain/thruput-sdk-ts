import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  blockHeight,
  contractAddress,
  networkHash,
  serializeCxs,
  sha256Hash,
} from "@groundhogchain/protocol";
import { fromHex, toHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  codec as contractSpecCodec,
  contractSpecString,
  type ContractTypeDef,
} from "@groundhogchain/contract-spec";
import { SIGNED_OP } from "../derivation/domainSeparator.js";
import { defineSignedOperation } from "./operation.js";
import { signedOperationPreimage } from "./preimage.js";

interface Vector {
  label: string;
  type_name: string;
  type_def_cxs_hex: string;
  network_hex: string;
  verifying_contract_hex: string;
  nonce: string;
  valid_until: string;
  body_cxs_hex: string;
  signed_message_hex: string;
}

interface VectorFile {
  version: number;
  category: string;
  domain_separator_cxs_hex: string;
  vectors: Vector[];
}

// Committed rather than regenerated: the pinned groundhog-test-vectors release
// predates the `signed-op` category. scripts/regen-test-vectors.sh refreshes
// it once the pin moves to a release that carries it.
const vectorsPath = fileURLToPath(
  new URL("../../specs/test-vectors/signed-op.json", import.meta.url),
);
const vectorFile = JSON.parse(readFileSync(vectorsPath, "utf-8")) as VectorFile;

const s = contractSpecString;

// The payload types the Rust generator derives its vectors from. Written out
// here exactly as `#[contract_type]` would describe them, so the test pins the
// type-definition encoding as well as the message around it.
const typeDefs: ContractTypeDef[] = [
  {
    v: ContractTypeDefKind.TypeDefStruct,
    struct_def: {
      name: s("Grant"),
      fields: [{ name: s("amount"), ty: { v: ContractTypeKind.U64 } }],
    },
  },
  {
    v: ContractTypeDefKind.TypeDefStruct,
    struct_def: {
      name: s("Revoke"),
      fields: [{ name: s("id"), ty: { v: ContractTypeKind.U64 } }],
    },
  },
  {
    v: ContractTypeDefKind.TypeDefStruct,
    struct_def: {
      name: s("Transfer"),
      fields: [
        { name: s("to"), ty: { v: ContractTypeKind.Address } },
        { name: s("amount"), ty: { v: ContractTypeKind.U64 } },
      ],
    },
  },
];

/** The payload value behind each vector, keyed by label. */
const bodies: Record<string, unknown> = {
  grant_zeroed: { amount: 0n },
  grant_typical: { amount: 500n },
  revoke_typical: { id: 500n },
  transfer_typical: {
    to: contractAddress(new Uint8Array(32).fill(0x07)),
    amount: 42n,
  },
  grant_extremes: { amount: 0xffff_ffff_ffff_ffffn },
};

function requestOf(v: Vector) {
  return {
    network: networkHash(sha256Hash(fromHex(v.network_hex))),
    verifyingContract: contractAddress(fromHex(v.verifying_contract_hex)),
    nonce: BigInt(v.nonce),
    validUntil: BigInt(v.valid_until),
    body: bodies[v.label],
  };
}

describe("golden vectors (signed_op)", () => {
  it("loads the expected vector category", () => {
    expect(vectorFile.category).toBe("signed_op");
    expect(vectorFile.version).toBe(1);
    expect(vectorFile.vectors.length).toBeGreaterThan(0);
    for (const v of vectorFile.vectors) {
      expect(bodies, `no payload value for vector ${v.label}`).toHaveProperty(
        v.label,
      );
    }
  });

  it("separator prefix matches domain_separator_cxs_hex", () => {
    expect(toHex(SIGNED_OP.bytes)).toBe(vectorFile.domain_separator_cxs_hex);
  });

  it.each(vectorFile.vectors.map((v) => [v.label, v] as const))(
    "%s: payload type definition encodes to type_def_cxs_hex",
    (_label, v) => {
      const operation = defineSignedOperation({
        typeDefs,
        typeName: v.type_name,
      });
      expect(
        toHex(
          serializeCxs(operation.typeDef, contractSpecCodec.ContractTypeDef),
        ),
      ).toBe(v.type_def_cxs_hex);
    },
  );

  it.each(vectorFile.vectors.map((v) => [v.label, v] as const))(
    "%s: payload value encodes to body_cxs_hex",
    (_label, v) => {
      const operation = defineSignedOperation({
        typeDefs,
        typeName: v.type_name,
      });
      expect(toHex(operation.encodeBody(bodies[v.label]))).toBe(v.body_cxs_hex);
    },
  );

  it.each(vectorFile.vectors.map((v) => [v.label, v] as const))(
    "%s: signed message matches signed_message_hex",
    (_label, v) => {
      const operation = defineSignedOperation({
        typeDefs,
        typeName: v.type_name,
      });
      expect(toHex(operation.preimage(requestOf(v)))).toBe(
        v.signed_message_hex,
      );
    },
  );

  it.each(vectorFile.vectors.map((v) => [v.label, v] as const))(
    "%s: signedOperationPreimage over raw body bytes agrees",
    (_label, v) => {
      const operation = defineSignedOperation({
        typeDefs,
        typeName: v.type_name,
      });
      const request = requestOf(v);
      const message = signedOperationPreimage({
        network: request.network,
        verifyingContract: request.verifyingContract,
        typeDef: operation.typeDef,
        nonce: request.nonce,
        validUntil: blockHeight(request.validUntil),
        body: fromHex(v.body_cxs_hex),
      });
      expect(toHex(message)).toBe(v.signed_message_hex);
    },
  );

  it("two payload types with identical encodings sign different messages", () => {
    const grant = vectorFile.vectors.find((v) => v.label === "grant_typical")!;
    const revoke = vectorFile.vectors.find(
      (v) => v.label === "revoke_typical",
    )!;
    expect(grant.body_cxs_hex).toBe(revoke.body_cxs_hex);
    expect(grant.signed_message_hex).not.toBe(revoke.signed_message_hex);
  });
});
