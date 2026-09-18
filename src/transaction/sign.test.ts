import { assert, describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
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
  networkHash,
} from "@groundhogchain/protocol";
import type { Contract } from "@groundhogchain/protocol";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { signTransaction } from "./sign.js";
import { transactionSignaturePreimage } from "./preimage.js";
import { TRANSACTION } from "../derivation/domainSeparator.js";
import { createInvocation, createTransaction } from "./build.js";

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
    const signer = new PrivateKeySigner(secretKey);

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
    const sig = signature.signature;
    expect(sig.scheme).toBe(0);
    expect(verify(sig.ed25519, preimage, signer.publicKey.ed25519)).toBe(true);

    // The bare transaction is no longer what gets signed.
    const txBytes = serialize(tx, codec.Transaction);
    expect(verify(sig.ed25519, txBytes, signer.publicKey.ed25519)).toBe(false);
  });

  it("binds the signature to one network", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 3;
    const signer = new PrivateKeySigner(secretKey);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    expect(signed.signatures).toHaveLength(1);
    const signature = signed.signatures[0];
    assert.isDefined(signature);
    const sig = signature.signature.ed25519;
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
    const signer = new PrivateKeySigner(secretKey);

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
    expect(restoredSignature.signature.ed25519).toEqual(
      originalSignature.signature.ed25519,
    );
  });

  it("supports multiple signers with distinct key IDs", async () => {
    const sk1 = new Uint8Array(32);
    sk1[0] = 10;
    const sk2 = new Uint8Array(32);
    sk2[0] = 20;
    const signer1 = new PrivateKeySigner(sk1);
    const signer2 = new PrivateKeySigner(sk2);

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
      signature1.signature.ed25519,
      preimage,
      signer1.publicKey.ed25519,
    );
    const valid2 = verify(
      signature2.signature.ed25519,
      preimage,
      signer2.publicKey.ed25519,
    );
    expect(valid1).toBe(true);
    expect(valid2).toBe(true);

    expect(signature1.signature.ed25519).not.toEqual(
      signature2.signature.ed25519,
    );
  });

  it.each([
    {
      label: "duplicate key IDs",
      signers: [
        {
          signer: new PrivateKeySigner(new Uint8Array(32).fill(1)),
          publicKeyId: 0n,
        },
        {
          signer: new PrivateKeySigner(new Uint8Array(32).fill(2)),
          publicKeyId: 0n,
        },
      ],
    },
    {
      label: "unordered key IDs",
      signers: [
        {
          signer: new PrivateKeySigner(new Uint8Array(32).fill(1)),
          publicKeyId: 1n,
        },
        {
          signer: new PrivateKeySigner(new Uint8Array(32).fill(2)),
          publicKeyId: 0n,
        },
      ],
    },
    {
      label: "out-of-range key ID",
      signers: [
        {
          signer: new PrivateKeySigner(new Uint8Array(32).fill(1)),
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
            signer: new PrivateKeySigner(new Uint8Array(32).fill(1)),
            publicKeyId: 1n,
          },
        ],
        testNetworkHash,
      ),
    ).rejects.toThrow("is not selected by authClaim");
  });

  it("requires exactly key ID zero for pubkey authorization", async () => {
    const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
    const transaction = makeDummyTransaction();
    transaction.auth_claim = {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: { pubkey: signer.publicKey, nonce: 0n },
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
    const baseSigner = new PrivateKeySigner(new Uint8Array(32).fill(3));
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
        signed.signatures[0]!.signature.ed25519,
        transactionSignaturePreimage(testNetworkHash, signed.tx),
        baseSigner.publicKey.ed25519,
      ),
    ).toBe(true);
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
