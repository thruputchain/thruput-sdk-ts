import { describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
import {
  CryptographicScheme,
  contractAddress,
  networkHash,
  sha256Hash,
} from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  contractSpecString,
  type ContractTypeDef,
} from "@groundhogchain/contract-spec";
import { PrivateKeySigner } from "../signers/privateKey.js";
import type { Signer } from "../signers/types.js";
import { defineSignedOperation } from "./operation.js";

const s = contractSpecString;

const typeDefs: ContractTypeDef[] = [
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

interface Transfer {
  to: ReturnType<typeof contractAddress>;
  amount: bigint;
}

const request = {
  network: networkHash(sha256Hash(new Uint8Array(32).fill(0x5a))),
  verifyingContract: contractAddress(new Uint8Array(32).fill(0x03)),
  nonce: 7n,
  validUntil: 1_000n,
  body: { to: contractAddress(new Uint8Array(32).fill(0x07)), amount: 42n },
};

describe("defineSignedOperation", () => {
  const transfer = defineSignedOperation<Transfer>({
    typeDefs,
    typeName: "Transfer",
  });
  const signer = new PrivateKeySigner(new Uint8Array(32).fill(0x11));

  it("rejects a payload type missing from the type definitions", () => {
    expect(() =>
      defineSignedOperation({ typeDefs, typeName: "Missing" }),
    ).toThrow(/"Missing" is not defined/);
  });

  it("produces the wire operation and an Ed25519 signature over the preimage", async () => {
    const signed = await transfer.sign(signer, request);

    expect(signed.op.signer).toEqual(signer.publicKey.ed25519);
    expect(signed.op.nonce).toBe(7n);
    expect(signed.op.valid_until).toBe(1_000n);
    expect(toHex(signed.op.body)).toBe(
      toHex(transfer.encodeBody(request.body)),
    );
    expect(signed.signature).toHaveLength(64);
    expect(
      verify(signed.signature, transfer.preimage(request), signed.op.signer),
    ).toBe(true);
  });

  it("changes the message when any header field changes", async () => {
    const base = transfer.preimage(request);
    const variants = [
      { ...request, nonce: 8n },
      { ...request, validUntil: 1_001n },
      {
        ...request,
        verifyingContract: contractAddress(new Uint8Array(32).fill(0x04)),
      },
      {
        ...request,
        network: networkHash(sha256Hash(new Uint8Array(32).fill(0xa5))),
      },
      { ...request, body: { ...request.body, amount: 43n } },
    ];
    for (const variant of variants) {
      expect(toHex(transfer.preimage(variant))).not.toBe(toHex(base));
    }
  });

  it("rejects mis-sized key or signature bytes from a custom signer", async () => {
    const shortKey = {
      publicKey: {
        scheme: CryptographicScheme.Ed25519,
        ed25519: new Uint8Array(31),
      },
      sign: signer.sign.bind(signer),
    } as unknown as Signer;
    await expect(transfer.sign(shortKey, request)).rejects.toThrow(
      /exactly 32 bytes/,
    );

    const shortSignature: Signer = {
      publicKey: signer.publicKey,
      async sign() {
        return {
          scheme: CryptographicScheme.Ed25519,
          ed25519: new Uint8Array(63),
        } as Awaited<ReturnType<Signer["sign"]>>;
      },
    };
    await expect(transfer.sign(shortSignature, request)).rejects.toThrow(
      /exactly 64 bytes/,
    );
  });

  it("binds a frozen snapshot of the type definition", () => {
    const mutable = structuredClone(typeDefs);
    const operation = defineSignedOperation<Transfer>({
      typeDefs: mutable,
      typeName: "Transfer",
    });
    const before = toHex(operation.preimage(request));

    // Neither the caller's array nor the returned definition can change what
    // gets signed after the fact.
    const def = mutable[0]!;
    if ("struct_def" in def) def.struct_def.fields[0]!.name = s("recipient");
    expect(toHex(operation.preimage(request))).toBe(before);
    expect(Object.isFrozen(operation.typeDef)).toBe(true);
    expect(() => {
      (operation.typeDef as { v: number }).v = 99;
    }).toThrow(TypeError);
  });

  it("refuses a signer whose key is not Ed25519", async () => {
    const bogus = {
      publicKey: { scheme: 0xff as CryptographicScheme },
      sign: signer.sign.bind(signer),
    } as unknown as Signer;
    await expect(transfer.sign(bogus, request)).rejects.toThrow(
      /Ed25519 signer/,
    );
  });
});
