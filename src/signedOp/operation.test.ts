import { assert, describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
import {
  CryptographicScheme,
  contractAddress,
  networkHash,
  sha256Hash,
} from "@thruputchain/protocol";
import { toHex } from "@thruputchain/protocol/utils";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  contractSpecString,
  type ContractTypeDef,
  type ContractSpecId,
} from "@thruputchain/contract-spec";
import { PrivateKeySigner } from "../signers/privateKey.js";
import type { Signer } from "../signers/types.js";
import { defineSignedOperation, randomNonce } from "./operation.js";

/** A spec id for a type declared at the root of a `fixture` crate. */
function specId(declared: string): ContractSpecId {
  return {
    crate_name: contractSpecString("fixture"),
    major: contractSpecString("0.1"),
    module_path: contractSpecString("fixture"),
    declared: contractSpecString(declared),
  };
}

const s = contractSpecString;

const typeDefs: ContractTypeDef[] = [
  {
    v: ContractTypeDefKind.TypeDefStruct,
    struct_def: {
      name: specId("Transfer"),
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
  blockExpiryHeight: 1_000n,
  nonce: 7n,
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

  it("rejects a payload name declared in more than one module", () => {
    const [transferDef] = typeDefs;
    assert(transferDef?.v === ContractTypeDefKind.TypeDefStruct);
    const elsewhere: ContractTypeDef = {
      ...transferDef,
      struct_def: {
        ...transferDef.struct_def,
        name: { ...specId("Transfer"), module_path: s("fixture::other") },
      },
    };
    expect(() =>
      defineSignedOperation({
        typeDefs: [...typeDefs, elsewhere],
        typeName: "Transfer",
      }),
    ).toThrow(/"Transfer" is ambiguous/);

    const selected = defineSignedOperation<Transfer>({
      typeDefs: [...typeDefs, elsewhere],
      typeName: {
        crate_name: "fixture",
        major: "0.1",
        module_path: "fixture::other",
        declared: "Transfer",
      },
    });
    expect(selected.typeName).toBe("Transfer");
    expect(selected.typeDef).toEqual(elsewhere);
    expect(
      defineSignedOperation<Transfer>({
        typeDefs: [...typeDefs, elsewhere],
        typeName: specId("Transfer"),
      }).typeDef,
    ).toEqual(transferDef);
  });

  it("rejects a full spec id that matches no type definition", () => {
    expect(() =>
      defineSignedOperation({
        typeDefs,
        typeName: { ...specId("Transfer"), major: "0.2" },
      }),
    ).toThrow(
      "Contract type fixture::Transfer (fixture@0.2) is not defined in the given type definitions",
    );
  });

  it("produces the wire operation and an Ed25519 signature over the preimage", async () => {
    const signed = await transfer.sign(signer, request);

    // The wire struct names no signer: the verifying contract checks against
    // the key it holds.
    expect(Object.keys(signed.op)).toEqual([
      "block_expiry_height",
      "nonce",
      "body",
    ]);
    expect(signed.op.block_expiry_height).toBe(1_000n);
    expect(signed.op.nonce).toBe(7n);
    expect(toHex(signed.op.body)).toBe(
      toHex(transfer.encodeBody(request.body)),
    );
    expect(signed.signature).toHaveLength(64);
    expect(
      verify(
        signed.signature,
        transfer.preimage(request),
        signer.publicKey.ed25519,
      ),
    ).toBe(true);
  });

  it("changes the message when any header field changes", async () => {
    const base = transfer.preimage(request);
    const variants = [
      { ...request, nonce: 8n },
      { ...request, blockExpiryHeight: 1_001n },
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

  it("rejects a mis-sized signature from a custom signer", async () => {
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

  it("signs and returns the request as it was before the signer was awaited", async () => {
    // A wallet prompt is asynchronous; a request mutated meanwhile must not
    // produce an operation that disagrees with the signed message.
    const mutable = { ...request } as {
      blockExpiryHeight: bigint;
      nonce: bigint;
    };
    const expectedMessage = transfer.preimage(request);
    const meddling: Signer = {
      publicKey: signer.publicKey,
      async sign(message) {
        mutable.nonce = 99n;
        mutable.blockExpiryHeight = 5n;
        return signer.sign(message);
      },
    };

    const signed = await transfer.sign(meddling, mutable as typeof request);

    expect(signed.op.block_expiry_height).toBe(1_000n);
    expect(signed.op.nonce).toBe(7n);
    expect(
      verify(signed.signature, expectedMessage, signer.publicKey.ed25519),
    ).toBe(true);
  });

  it("copies signer-owned signature bytes", async () => {
    const sig = new Uint8Array(64).fill(0x42);
    const owned: Signer = {
      publicKey: signer.publicKey,
      async sign() {
        return { scheme: CryptographicScheme.Ed25519, ed25519: sig };
      },
    } as unknown as Signer;

    const signed = await transfer.sign(owned, request);
    sig.fill(0);

    expect(signed.signature).toEqual(new Uint8Array(64).fill(0x42));
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

describe("randomNonce", () => {
  it("draws a u64", () => {
    for (let i = 0; i < 64; i++) {
      const nonce = randomNonce();
      expect(nonce).toBeGreaterThanOrEqual(0n);
      expect(nonce).toBeLessThanOrEqual(0xffff_ffff_ffff_ffffn);
    }
  });

  it("does not repeat", () => {
    const drawn = new Set<bigint>();
    for (let i = 0; i < 64; i++) drawn.add(randomNonce());
    expect(drawn.size).toBe(64);
  });
});
