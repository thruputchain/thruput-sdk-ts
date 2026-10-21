import { assert, describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  calldata,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  blockHeight,
  AuthClaimType,
  bitMap,
  weight,
  serialize,
  deserialize,
  codec,
  sha256Hash,
  ContractType,
  CryptographicScheme,
  mlDsa65Signature,
  networkHash,
} from "@thruputchain/protocol";
import type { Contract, Transaction } from "@thruputchain/protocol";
import { Ed25519Signer } from "../signers/ed25519.js";
import type { Signer } from "../signers/types.js";
import { signTransaction } from "./sign.js";
import { transactionSignaturePreimage } from "./preimage.js";
import { TRANSACTION } from "../derivation/domainSeparator.js";
import { createInvocation, createTransaction } from "./build.js";
import { MlDsa65Signer, verifyMlDsa65 } from "../signers/mlDsa65.js";
import { pubkeyAccountPreimage } from "../derivation/pubkeyAccount.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { pubkeySignatureEnvelopeBytes } from "./size.js";
import { ed25519Of, mlDsa65Of } from "../testing/signatures.js";

const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0x5a)));
const otherNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0xa5)));

function makeDummyTransaction(contractsToDeploy: Contract[] = []) {
  const invocation = createInvocation({
    invoked_address: contractAddress(new Uint8Array(32)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3, 4])),
  });

  return createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(100n),
      nonce: 42n,
    },
    contracts_to_deploy: contractsToDeploy,
    auth_claim: {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(0xffffffffn),
        required_weight: weight(1n),
      },
    },
  });
}

describe("signTransaction", () => {
  it("produces a valid Ed25519 signature over the canonical preimage", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 1;
    const signer = new Ed25519Signer(secretKey);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    expect(signed.tx).toEqual(tx);
    expect(signed.signatures).toHaveLength(1);
    const signature = signed.signatures[0];
    assert.isDefined(signature);
    expect(signature.public_key_id).toBe(0n);

    const preimage = transactionSignaturePreimage(testNetworkHash, tx);
    expect(signature.signature.scheme).toBe(0);
    const sig = ed25519Of(signature.signature);
    expect(verify(sig, preimage, signer.publicKey.ed25519)).toBe(true);

    // The bare transaction is no longer what gets signed.
    const txBytes = serialize(tx, codec.Transaction);
    expect(verify(sig, txBytes, signer.publicKey.ed25519)).toBe(false);
  });

  it("binds the signature to one network", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 3;
    const signer = new Ed25519Signer(secretKey);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    expect(signed.signatures).toHaveLength(1);
    const signature = signed.signatures[0];
    assert.isDefined(signature);
    const sig = ed25519Of(signature.signature);
    const key = signer.publicKey.ed25519;
    expect(
      verify(sig, transactionSignaturePreimage(testNetworkHash, tx), key),
    ).toBe(true);
    expect(
      verify(sig, transactionSignaturePreimage(otherNetworkHash, tx), key),
    ).toBe(false);
  });

  it("round-trips through serialization", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 2;
    const signer = new Ed25519Signer(secretKey);

    const tx = makeDummyTransaction([
      {
        contract_type: ContractType.kRv32,
        rv32_contract: { data: new Uint8Array([0x47, 0x48, 0x52, 0x56]) },
      },
    ]);
    const signed = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    const bytes = serialize(signed, codec.SignedTransaction);
    const deserialized = deserialize(bytes, codec.SignedTransaction);

    expect(deserialized.tx).toEqual(signed.tx);
    expect(deserialized.signatures).toHaveLength(1);
    const restoredSignature = deserialized.signatures[0];
    const originalSignature = signed.signatures[0];
    assert.isDefined(restoredSignature);
    assert.isDefined(originalSignature);
    expect(restoredSignature.public_key_id).toBe(0n);
    expect(ed25519Of(restoredSignature.signature)).toEqual(
      ed25519Of(originalSignature.signature),
    );
  });

  it("supports multiple signers with distinct key IDs", async () => {
    const sk1 = new Uint8Array(32);
    sk1[0] = 10;
    const sk2 = new Uint8Array(32);
    sk2[0] = 20;
    const signer1 = new Ed25519Signer(sk1);
    const signer2 = new Ed25519Signer(sk2);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(
      tx,
      [
        { signer: signer1, publicKeyId: 0n },
        { signer: signer2, publicKeyId: 1n },
      ],
      testNetworkHash,
    );

    expect(signed.signatures).toHaveLength(2);
    const [signature1, signature2] = signed.signatures;
    assert.isDefined(signature1);
    assert.isDefined(signature2);
    expect(signature1.public_key_id).toBe(0n);
    expect(signature2.public_key_id).toBe(1n);

    const preimage = transactionSignaturePreimage(testNetworkHash, tx);
    const valid1 = verify(
      ed25519Of(signature1.signature),
      preimage,
      signer1.publicKey.ed25519,
    );
    const valid2 = verify(
      ed25519Of(signature2.signature),
      preimage,
      signer2.publicKey.ed25519,
    );
    expect(valid1).toBe(true);
    expect(valid2).toBe(true);

    expect(ed25519Of(signature1.signature)).not.toEqual(
      ed25519Of(signature2.signature),
    );
  });

  it.each([
    {
      label: "duplicate key IDs",
      signers: [
        {
          signer: new Ed25519Signer(new Uint8Array(32).fill(1)),
          publicKeyId: 0n,
        },
        {
          signer: new Ed25519Signer(new Uint8Array(32).fill(2)),
          publicKeyId: 0n,
        },
      ],
    },
    {
      label: "unordered key IDs",
      signers: [
        {
          signer: new Ed25519Signer(new Uint8Array(32).fill(1)),
          publicKeyId: 1n,
        },
        {
          signer: new Ed25519Signer(new Uint8Array(32).fill(2)),
          publicKeyId: 0n,
        },
      ],
    },
    {
      label: "out-of-range key ID",
      signers: [
        {
          signer: new Ed25519Signer(new Uint8Array(32).fill(1)),
          publicKeyId: 21n,
        },
      ],
    },
  ])("rejects $label", async ({ signers }) => {
    await expect(
      signTransaction(makeDummyTransaction(), signers, testNetworkHash),
    ).rejects.toThrow();
  });

  it("allows an empty source-address signature list", async () => {
    await expect(
      signTransaction(makeDummyTransaction(), [], testNetworkHash),
    ).resolves.toEqual(expect.objectContaining({ signatures: [] }));
  });

  it("rejects keys outside the source-address auth bitmap", async () => {
    const transaction = makeDummyTransaction();
    if (
      transaction.auth_claim.claim_type !== AuthClaimType.kSourceAddressAuthData
    ) {
      throw new Error("expected source-address auth");
    }
    transaction.auth_claim.source_address_claim.allowed_keys = bitMap(1n);

    await expect(
      signTransaction(
        transaction,
        [
          {
            signer: new Ed25519Signer(new Uint8Array(32).fill(1)),
            publicKeyId: 1n,
          },
        ],
        testNetworkHash,
      ),
    ).rejects.toThrow("is not selected by authClaim");
  });

  it("requires exactly key ID zero for pubkey authorization", async () => {
    const signer = new Ed25519Signer(new Uint8Array(32).fill(1));
    const transaction = makeDummyTransaction();
    transaction.auth_claim = {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: pubkeyAccountPreimage(signer.publicKey),
    };

    await expect(
      signTransaction(
        transaction,
        [{ signer, publicKeyId: 1n }],
        testNetworkHash,
      ),
    ).rejects.toThrow("requires only publicKeyId 0");
  });

  it("snapshots the transaction and key IDs before asynchronous signing", async () => {
    const baseSigner = new Ed25519Signer(new Uint8Array(32).fill(3));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayedSigner = {
      publicKey: baseSigner.publicKey,
      async sign(message: Uint8Array) {
        await gate;
        return baseSigner.sign(message);
      },
    };
    const tx = makeDummyTransaction();
    const entry = { signer: delayedSigner, publicKeyId: 0n };
    const pending = signTransaction(tx, [entry], testNetworkHash);

    tx.invocation.calldata.fill(0xff);
    entry.publicKeyId = 1n;
    release();
    const signed = await pending;

    expect(signed.tx.invocation.calldata).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(signed.signatures[0]!.public_key_id).toBe(0n);
    expect(
      verify(
        ed25519Of(signed.signatures[0]!.signature),
        transactionSignaturePreimage(testNetworkHash, signed.tx),
        baseSigner.publicKey.ed25519,
      ),
    ).toBe(true);
  });
});

function pubkeyTransaction(signer: Signer): Transaction {
  const transaction = makeDummyTransaction();
  transaction.auth_claim = {
    claim_type: AuthClaimType.kPubkeySignature,
    pubkey_preimage: pubkeyAccountPreimage(signer.publicKey, 3n),
  };
  return transaction;
}

describe("signTransaction pubkey envelope", () => {
  const ed25519Signer = new Ed25519Signer(new Uint8Array(32).fill(4));
  const mlDsaSigner = MlDsa65Signer.fromSeed(new Uint8Array(32).fill(5));

  it("attaches the Ed25519 key as pubkey_claim_key", async () => {
    const tx = pubkeyTransaction(ed25519Signer);
    const signed = await signTransaction(
      tx,
      [{ signer: ed25519Signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    expect(signed.pubkey_claim_key).toEqual(ed25519Signer.publicKey);
    expect(signed.pubkey_claim_key).not.toBe(ed25519Signer.publicKey);
    expect(
      verify(
        ed25519Of(signed.signatures[0]!.signature),
        transactionSignaturePreimage(testNetworkHash, tx),
        ed25519Signer.publicKey.ed25519,
      ),
    ).toBe(true);
    const restored = deserialize(
      serialize(signed, codec.SignedTransaction),
      codec.SignedTransaction,
    );
    expect(restored).toEqual(signed);
  });

  it("signs an ML-DSA-65 pubkey claim over the same preimage", async () => {
    const tx = pubkeyTransaction(mlDsaSigner);
    const signed = await signTransaction(
      tx,
      [{ signer: mlDsaSigner, publicKeyId: 0n }],
      testNetworkHash,
    );

    expect(signed.pubkey_claim_key).toEqual(mlDsaSigner.publicKey);
    const signature = mlDsa65Of(signed.signatures[0]!.signature);
    expect(signature).toHaveLength(3309);
    const preimage = transactionSignaturePreimage(testNetworkHash, tx);
    expect(
      verifyMlDsa65(mlDsaSigner.publicKey.mldsa65, preimage, signature),
    ).toBe(true);
    expect(
      verifyMlDsa65(
        mlDsaSigner.publicKey.mldsa65,
        transactionSignaturePreimage(otherNetworkHash, tx),
        signature,
      ),
    ).toBe(false);

    const bytes = serialize(signed, codec.SignedTransaction);
    expect(bytes.length).toBe(
      serialize(tx, codec.Transaction).length +
        pubkeySignatureEnvelopeBytes(CryptographicScheme.MlDsa65),
    );
    expect(deserialize(bytes, codec.SignedTransaction)).toEqual(signed);
  });

  it("keeps the transaction hash when re-signing", async () => {
    const tx = pubkeyTransaction(mlDsaSigner);
    const first = await signTransaction(
      tx,
      [{ signer: mlDsaSigner, publicKeyId: 0n }],
      testNetworkHash,
    );
    const second = await signTransaction(
      tx,
      [{ signer: mlDsaSigner, publicKeyId: 0n }],
      testNetworkHash,
    );

    // Hedged ML-DSA signs differently each time; the identifier does not move.
    expect(second.signatures).not.toEqual(first.signatures);
    expect(hashSignedTransaction(second)).toEqual(hashSignedTransaction(first));
    expect(
      hashSignedTransaction({
        ...first,
        signatures: [],
        pubkey_claim_key: null,
      }),
    ).toEqual(hashSignedTransaction(first));
  });

  it("rejects a signer whose key does not hash to the claim", async () => {
    const tx = pubkeyTransaction(ed25519Signer);
    await expect(
      signTransaction(
        tx,
        [{ signer: mlDsaSigner, publicKeyId: 0n }],
        testNetworkHash,
      ),
    ).rejects.toThrow("does not match the auth claim's pubkey_hash");
  });

  it("rejects a signature whose scheme differs from the key", async () => {
    const lying: Signer = {
      publicKey: mlDsaSigner.publicKey,
      sign: (message) => ed25519Signer.sign(message),
    };
    await expect(
      signTransaction(
        pubkeyTransaction(mlDsaSigner),
        [{ signer: lying, publicKeyId: 0n }],
        testNetworkHash,
      ),
    ).rejects.toThrow("scheme does not match");
  });

  it("requires exactly one signer for pubkey authorization", async () => {
    await expect(
      signTransaction(pubkeyTransaction(ed25519Signer), [], testNetworkHash),
    ).rejects.toThrow("requires only publicKeyId 0");
  });

  it("attaches no key to source-address claims", async () => {
    const signed = await signTransaction(
      makeDummyTransaction(),
      [{ signer: ed25519Signer, publicKeyId: 0n }],
      testNetworkHash,
    );
    expect(signed.pubkey_claim_key).toBeNull();
  });
});

describe("MlDsa65Signer", () => {
  it("derives the same key from the same seed", () => {
    const seed = new Uint8Array(32).fill(9);
    const a = MlDsa65Signer.fromSeed(seed);
    const b = MlDsa65Signer.fromSeed(seed);
    expect(a.publicKey.scheme).toBe(CryptographicScheme.MlDsa65);
    expect(a.publicKey.mldsa65).toHaveLength(1952);
    expect(b.publicKey).toEqual(a.publicKey);
  });

  it("signs deterministically on request", async () => {
    const signer = MlDsa65Signer.fromSeed(new Uint8Array(32).fill(9), {
      deterministic: true,
    });
    const message = new Uint8Array([1, 2, 3]);
    expect(await signer.sign(message)).toEqual(await signer.sign(message));
  });

  it("uses pure ML-DSA with an empty context", async () => {
    const signer = MlDsa65Signer.fromSeed(new Uint8Array(32).fill(9));
    const message = new Uint8Array([1, 2, 3]);
    const signature = mlDsa65Of(await signer.sign(message));
    expect(
      ml_dsa65.verify(signature, message, signer.publicKey.mldsa65, {
        context: new Uint8Array(),
      }),
    ).toBe(true);
    expect(
      ml_dsa65.verify(signature, message, signer.publicKey.mldsa65, {
        context: new Uint8Array([1]),
      }),
    ).toBe(false);
  });

  it("rejects a seed of the wrong length", () => {
    expect(() => MlDsa65Signer.fromSeed(new Uint8Array(31))).toThrow(
      "32 bytes",
    );
  });

  it("verifyMlDsa65 rejects a tampered signature", async () => {
    const signer = MlDsa65Signer.fromSeed(new Uint8Array(32).fill(9));
    const message = new Uint8Array([1, 2, 3]);
    const signature = mlDsa65Of(await signer.sign(message));
    const tampered = mlDsa65Signature(new Uint8Array(signature));
    tampered[0] = tampered[0]! ^ 1;
    expect(verifyMlDsa65(signer.publicKey.mldsa65, message, tampered)).toBe(
      false,
    );
  });
});

describe("Ed25519Signer", () => {
  it("fromSeed derives the same key as the constructor", () => {
    const seed = new Uint8Array(32).fill(9);
    const signer = Ed25519Signer.fromSeed(seed);
    expect(signer.publicKey.scheme).toBe(CryptographicScheme.Ed25519);
    expect(signer.publicKey).toEqual(new Ed25519Signer(seed).publicKey);
  });

  it("fromSeed keeps its own copy of the seed", async () => {
    const seed = new Uint8Array(32).fill(9);
    const signer = Ed25519Signer.fromSeed(seed);
    seed.fill(0);
    const message = new Uint8Array([1, 2, 3]);
    const signature = ed25519Of(await signer.sign(message));
    expect(verify(signature, message, signer.publicKey.ed25519)).toBe(true);
  });

  it("rejects a seed of the wrong length", () => {
    expect(() => Ed25519Signer.fromSeed(new Uint8Array(31))).toThrow(
      "32 bytes",
    );
  });
});

describe("pubkeySignatureEnvelopeBytes", () => {
  it("reserves room for the signature and the attached key", () => {
    expect(pubkeySignatureEnvelopeBytes(CryptographicScheme.Ed25519)).toBe(116);
    expect(pubkeySignatureEnvelopeBytes(CryptographicScheme.MlDsa65)).toBe(
      5284,
    );
  });
});

describe("transactionSignaturePreimage", () => {
  // Pins the layout the C++ and Rust implementations have to reproduce.
  it("is the domain separator, then the network hash, then the transaction", () => {
    const tx = makeDummyTransaction();
    const preimage = transactionSignaturePreimage(testNetworkHash, tx);
    const prefix = TRANSACTION.bytes;
    const payload = serialize(tx, codec.Transaction);

    expect(prefix).toEqual(
      new Uint8Array([0x00, 0x0b, ...new TextEncoder().encode("Transaction")]),
    );
    expect(preimage).toHaveLength(
      prefix.length + testNetworkHash.length + payload.length,
    );
    expect(preimage.slice(0, prefix.length)).toEqual(prefix);
    expect(
      preimage.slice(prefix.length, prefix.length + testNetworkHash.length),
    ).toEqual(new Uint8Array(testNetworkHash));
    expect(preimage.slice(prefix.length + testNetworkHash.length)).toEqual(
      payload,
    );
  });

  it("changes when the network hash changes", () => {
    const tx = makeDummyTransaction();
    expect(transactionSignaturePreimage(testNetworkHash, tx)).not.toEqual(
      transactionSignaturePreimage(otherNetworkHash, tx),
    );
  });
});
