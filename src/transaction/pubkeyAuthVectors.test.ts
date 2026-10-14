import { describe, expect, it } from "vitest";
import { verify as ed25519Verify } from "@noble/ed25519";
import {
  AuthClaimType,
  CryptographicScheme,
  codec,
  deserialize,
  fromHex,
  networkHash as toNetworkHash,
  serialize,
  serializeCxs,
  sha256Hash,
  toHex,
} from "@thruputchain/protocol";
import type { PublicKey, SignedTransaction } from "@thruputchain/protocol";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { MlDsa65Signer, verifyMlDsa65 } from "../signers/mlDsa65.js";
import type { Signer } from "../signers/types.js";
import {
  PUBKEY_ACCOUNT,
  PUBLIC_KEY,
  TRANSACTION,
} from "../derivation/domainSeparator.js";
import { derivePublicKeyHash } from "../derivation/publicKeyHash.js";
import {
  derivePubkeyAccountAddress,
  pubkeyAccountPreimage,
} from "../derivation/pubkeyAccount.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { transactionSignaturePreimage } from "./preimage.js";
import { signTransaction } from "./sign.js";
import { pubkeySignatureEnvelopeBytes } from "./size.js";
import { mlDsa65Of } from "../testing/signatures.js";

// Copied from thruput-protocol test_vectors/pubkey_auth.json; see the README
// next to it for the meaning of each field.
interface KeyVector {
  name: string;
  scheme: "Ed25519" | "MlDsa65";
  seed: string;
  public_key: string;
  public_key_cxs: string;
  public_key_xdr: string;
  public_key_hash: string;
  accounts: {
    nonce: string;
    pubkey_account_preimage_cxs: string;
    address: string;
  }[];
}

interface SigningVector {
  name: string;
  key: string;
  network_hash: string;
  transaction: {
    invoked_address: string;
    pubkey_hash: string;
    account_nonce: string;
  };
  transaction_xdr: string;
  signing_preimage: string;
  transaction_hash: string;
  signature: string;
  signed_transaction_xdr: string;
}

interface VectorFile {
  format_version: number;
  domain_separators: Record<string, { name: string; cxs: string }>;
  keys: KeyVector[];
  signing: SigningVector[];
  resigning: {
    name: string;
    of: string;
    signature: string;
    signed_transaction_xdr: string;
    transaction_hash: string;
  }[];
  negative: {
    name: string;
    network_hash: string;
    signed_transaction_xdr: string;
    transaction_hash: string;
    expected: { result: "reject"; error_code: AuthVerifyCode };
  }[];
}

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../specs/test-vectors/pubkey_auth.json", import.meta.url),
    ),
    "utf-8",
  ),
) as VectorFile;

/** hogd's `AuthVerifyErrorCode`, with 0 for an accepted transaction. */
type AuthVerifyCode = 0 | 1 | 2;
const kAuthMalformed = 1;
const kSignatureVerificationFailed = 2;

/**
 * hogd's `kPubkeySignature` checks, built from this SDK's own derivation and
 * signature verifiers. The vectors give hogd's code for each rejection, so a
 * verifier here that accepts or rejects differently fails the matching case.
 */
function verifyPubkeyAuth(
  signed: SignedTransaction,
  networkHashHex: string,
): AuthVerifyCode {
  const { tx, signatures, pubkey_claim_key: key } = signed;
  if (tx.auth_claim.claim_type !== AuthClaimType.kPubkeySignature) {
    return key === null ? 0 : kAuthMalformed;
  }
  const preimage = tx.auth_claim.pubkey_preimage;
  if (
    key === null ||
    toHex(derivePublicKeyHash(key)) !== toHex(preimage.pubkey_hash) ||
    toHex(derivePubkeyAccountAddress(preimage)) !==
      toHex(tx.invocation.invoked_address) ||
    signatures.length !== 1 ||
    signatures[0]!.public_key_id !== 0n ||
    signatures[0]!.signature.scheme !== key.scheme
  ) {
    return kAuthMalformed;
  }
  const message = transactionSignaturePreimage(
    toNetworkHash(sha256Hash(fromHex(networkHashHex))),
    tx,
  );
  const signature = signatures[0]!.signature;
  const valid =
    key.scheme === CryptographicScheme.Ed25519 &&
    signature.scheme === CryptographicScheme.Ed25519
      ? ed25519Verify(signature.ed25519, message, key.ed25519, {
          zip215: false,
        })
      : key.scheme === CryptographicScheme.MlDsa65 &&
        signature.scheme === CryptographicScheme.MlDsa65 &&
        verifyMlDsa65(key.mldsa65, message, signature.mldsa65);
  return valid ? 0 : kSignatureVerificationFailed;
}

function keyByName(name: string): KeyVector {
  const key = vectors.keys.find((candidate) => candidate.name === name);
  if (!key) throw new Error(`unknown key ${name}`);
  return key;
}

function signerFor(key: KeyVector): Signer {
  const seed = fromHex(key.seed);
  return key.scheme === "Ed25519"
    ? new PrivateKeySigner(seed)
    : MlDsa65Signer.fromSeed(seed, { deterministic: true });
}

describe("pubkey_auth vectors", () => {
  it("uses format version 1", () => {
    expect(vectors.format_version).toBe(1);
  });

  it("matches the domain separators", () => {
    expect(toHex(PUBLIC_KEY.bytes)).toBe(
      vectors.domain_separators.PublicKey!.cxs,
    );
    expect(toHex(PUBKEY_ACCOUNT.bytes)).toBe(
      vectors.domain_separators.PubkeyAccount!.cxs,
    );
    expect(toHex(TRANSACTION.bytes)).toBe(
      vectors.domain_separators.Transaction!.cxs,
    );
  });

  describe.each(vectors.keys.map((key) => [key.name, key] as const))(
    "key %s",
    (_name, key) => {
      const publicKey: PublicKey = signerFor(key).publicKey;

      it("derives the public key from the seed", () => {
        expect(toHex(serialize(publicKey, codec.PublicKey))).toBe(
          key.public_key_xdr,
        );
        expect(toHex(serializeCxs(publicKey, codec.PublicKey))).toBe(
          key.public_key_cxs,
        );
      });

      it("hashes the key", () => {
        expect(toHex(derivePublicKeyHash(publicKey))).toBe(key.public_key_hash);
      });

      it.each(key.accounts.map((account) => [account.nonce, account] as const))(
        "derives the nonce %s account",
        (nonce, account) => {
          const preimage = pubkeyAccountPreimage(publicKey, BigInt(nonce));
          expect(
            toHex(serializeCxs(preimage, codec.PubkeyAccountPreimage)),
          ).toBe(account.pubkey_account_preimage_cxs);
          expect(toHex(derivePubkeyAccountAddress(preimage))).toBe(
            account.address,
          );
        },
      );
    },
  );

  describe.each(
    vectors.signing.map((vector) => [vector.name, vector] as const),
  )("signing %s", (_name, vector) => {
    const key = keyByName(vector.key);
    const network = toNetworkHash(sha256Hash(fromHex(vector.network_hash)));
    const tx = deserialize(fromHex(vector.transaction_xdr), codec.Transaction);

    it("decodes the claim and builds the preimage and hash", () => {
      expect(toHex(tx.invocation.invoked_address)).toBe(
        vector.transaction.invoked_address,
      );
      expect(tx.auth_claim.claim_type).toBe(AuthClaimType.kPubkeySignature);
      if (tx.auth_claim.claim_type !== AuthClaimType.kPubkeySignature) return;
      expect(toHex(tx.auth_claim.pubkey_preimage.pubkey_hash)).toBe(
        vector.transaction.pubkey_hash,
      );
      expect(tx.auth_claim.pubkey_preimage.nonce).toBe(
        BigInt(vector.transaction.account_nonce),
      );
      expect(toHex(transactionSignaturePreimage(network, tx))).toBe(
        vector.signing_preimage,
      );
    });

    it("reproduces the signed transaction byte for byte", async () => {
      const signed = await signTransaction(
        tx,
        [{ signer: signerFor(key), publicKeyId: 0n }],
        network,
      );
      const bytes = serialize(signed, codec.SignedTransaction);
      expect(toHex(bytes)).toBe(vector.signed_transaction_xdr);
      expect(toHex(hashSignedTransaction(signed))).toBe(
        vector.transaction_hash,
      );
      expect(bytes.length - fromHex(vector.transaction_xdr).length).toBe(
        pubkeySignatureEnvelopeBytes(signed.signatures[0]!.signature.scheme),
      );
    });

    it("decodes the signed transaction", () => {
      const signed = deserialize(
        fromHex(vector.signed_transaction_xdr),
        codec.SignedTransaction,
      );
      expect(signed.tx).toEqual(tx);
      expect(signed.pubkey_claim_key).toEqual(signerFor(key).publicKey);
      expect(toHex(hashSignedTransaction(signed))).toBe(
        vector.transaction_hash,
      );
    });
  });

  it.each(vectors.resigning.map((vector) => [vector.name, vector] as const))(
    "re-signing %s keeps the transaction hash",
    (_name, vector) => {
      const base = vectors.signing.find((entry) => entry.name === vector.of)!;
      const key = keyByName(base.key);
      const signed = deserialize(
        fromHex(vector.signed_transaction_xdr),
        codec.SignedTransaction,
      );
      expect(vector.signed_transaction_xdr).not.toBe(
        base.signed_transaction_xdr,
      );
      expect(vector.transaction_hash).toBe(base.transaction_hash);
      expect(toHex(hashSignedTransaction(signed))).toBe(base.transaction_hash);

      const signature = mlDsa65Of(signed.signatures[0]!.signature);
      expect(toHex(signature)).toBe(vector.signature);
      const publicKey = signerFor(key).publicKey;
      if (!("mldsa65" in publicKey)) throw new Error("expected ML-DSA-65 key");
      expect(
        verifyMlDsa65(
          publicKey.mldsa65,
          fromHex(base.signing_preimage),
          signature,
        ),
      ).toBe(true);
    },
  );

  describe("verification matches hogd", () => {
    it.each(vectors.signing.map((vector) => [vector.name, vector] as const))(
      "accepts %s",
      (_name, vector) => {
        const signed = deserialize(
          fromHex(vector.signed_transaction_xdr),
          codec.SignedTransaction,
        );
        expect(verifyPubkeyAuth(signed, vector.network_hash)).toBe(0);
      },
    );

    it.each(vectors.resigning.map((vector) => [vector.name, vector] as const))(
      "accepts the hedged re-signature %s",
      (_name, vector) => {
        const base = vectors.signing.find((entry) => entry.name === vector.of)!;
        const signed = deserialize(
          fromHex(vector.signed_transaction_xdr),
          codec.SignedTransaction,
        );
        expect(verifyPubkeyAuth(signed, base.network_hash)).toBe(0);
      },
    );

    it.each(vectors.negative.map((vector) => [vector.name, vector] as const))(
      "rejects %s with hogd's error code",
      (_name, vector) => {
        expect(vector.expected.result).toBe("reject");
        const signed = deserialize(
          fromHex(vector.signed_transaction_xdr),
          codec.SignedTransaction,
        );
        expect(verifyPubkeyAuth(signed, vector.network_hash)).toBe(
          vector.expected.error_code,
        );
      },
    );
  });

  it.each(vectors.negative.map((vector) => [vector.name, vector] as const))(
    "negative %s keeps the transaction hash of its Transaction",
    (_name, vector) => {
      const signed = deserialize(
        fromHex(vector.signed_transaction_xdr),
        codec.SignedTransaction,
      );
      expect(toHex(hashSignedTransaction(signed))).toBe(
        vector.transaction_hash,
      );
    },
  );
});
