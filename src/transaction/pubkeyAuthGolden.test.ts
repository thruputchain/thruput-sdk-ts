import { describe, expect, it } from "vitest";
import {
  AuthClaimType,
  blockHeight,
  calldata,
  codec,
  contractEntrypointID,
  CryptographicScheme,
  fromHex,
  gasAmount,
  mlDsa65Signature,
  networkHash as toNetworkHash,
  serialize,
  serializeCxs,
  sha256Hash,
  toHex,
} from "@thruputchain/protocol";
import type {
  PublicKey,
  SignedTransaction,
  Transaction,
} from "@thruputchain/protocol";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRANSACTION } from "../derivation/domainSeparator.js";
import { derivePublicKeyHash } from "../derivation/publicKeyHash.js";
import {
  derivePubkeyAccountAddress,
  pubkeyAccountPreimage,
} from "../derivation/pubkeyAccount.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { MlDsa65Signer } from "../signers/mlDsa65.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import type { Signer } from "../signers/types.js";
import { mlDsa65Of } from "../testing/signatures.js";
import { transactionSignaturePreimage } from "./preimage.js";
import { signTransaction } from "./sign.js";

// `thruput-test-vectors pubkey-auth` from thruput-sdk-rs: signed transactions
// from Ed25519 and ML-DSA-65 pubkey accounts, built with the Rust SDK and
// checked there against hogd's verifier (test-ffi). Each stage is replayed
// here with this SDK's own code, so a mismatch names the stage that drifted.
interface Vector {
  name: string;
  scheme: "Ed25519" | "MlDsa65";
  seed_hex: string;
  signature_rnd_hex: string | null;
  resign_of: string | null;
  public_key_hex: string;
  public_key_cxs_hex: string;
  public_key_hash_hex: string;
  account_nonce: string;
  address_hex: string;
  network: string;
  network_hash_hex: string;
  transaction: {
    invoked_address_hex: string;
    entrypoint_hex: string;
    gas_limit: string;
    calldata_hex: string;
    block_expiry_height: string;
    uniquifier_nonce: string;
  };
  transaction_xdr_hex: string;
  signing_preimage_hex: string;
  transaction_hash_hex: string;
  signature_hex: string;
  signed_transaction_xdr_hex: string;
}

interface VectorFile {
  version: number;
  category: string;
  transaction_domain_separator_cxs_hex: string;
  pubkey_claim_key_id: number;
  vectors: Vector[];
}

// Committed so these tests run without the generator installed; the regen
// script overwrites it from the pinned thruput-test-vectors release.
const vectorsPath = fileURLToPath(
  new URL("../../specs/test-vectors/pubkey-auth.json", import.meta.url),
);
const vectorFile = JSON.parse(readFileSync(vectorsPath, "utf-8")) as VectorFile;

function signerFor(v: Vector): Signer {
  const seed = fromHex(v.seed_hex);
  return v.scheme === "Ed25519"
    ? new PrivateKeySigner(seed)
    : MlDsa65Signer.fromSeed(seed, { deterministic: true });
}

function keyBytes(key: PublicKey): Uint8Array {
  return "ed25519" in key ? key.ed25519 : key.mldsa65;
}

/** The unsigned transaction, built from the vector's decoded fields. */
function buildTransaction(v: Vector, publicKey: PublicKey): Transaction {
  const preimage = pubkeyAccountPreimage(publicKey, BigInt(v.account_nonce));
  return {
    invocation: {
      invoked_address: derivePubkeyAccountAddress(preimage),
      entrypoint: contractEntrypointID(fromHex(v.transaction.entrypoint_hex)),
      gas_limit: gasAmount(BigInt(v.transaction.gas_limit)),
      calldata: calldata(fromHex(v.transaction.calldata_hex)),
    },
    uniquifier: {
      block_expiry_height: blockHeight(
        BigInt(v.transaction.block_expiry_height),
      ),
      nonce: BigInt(v.transaction.uniquifier_nonce),
    },
    contracts_to_deploy: [],
    auth_claim: {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: preimage,
    },
  };
}

describe("golden vectors (pubkey_auth)", () => {
  it("loads the expected vector category", () => {
    expect(vectorFile.version).toBe(1);
    expect(vectorFile.category).toBe("pubkey_auth");
    expect(vectorFile.vectors.some((v) => v.scheme === "Ed25519")).toBe(true);
    expect(vectorFile.vectors.some((v) => v.scheme === "MlDsa65")).toBe(true);
    expect(toHex(TRANSACTION.bytes)).toBe(
      vectorFile.transaction_domain_separator_cxs_hex,
    );
  });

  describe.each(vectorFile.vectors.map((v) => [v.name, v] as const))(
    "%s",
    (_name, v) => {
      const signer = signerFor(v);
      const publicKey = signer.publicKey;
      const network = toNetworkHash(sha256Hash(fromHex(v.network_hash_hex)));
      const tx = buildTransaction(v, publicKey);

      it("derives the key, its hash and the account address", () => {
        expect(toHex(keyBytes(publicKey))).toBe(v.public_key_hex);
        expect(toHex(serializeCxs(publicKey, codec.PublicKey))).toBe(
          v.public_key_cxs_hex,
        );
        expect(toHex(derivePublicKeyHash(publicKey))).toBe(
          v.public_key_hash_hex,
        );
        expect(toHex(tx.invocation.invoked_address)).toBe(v.address_hex);
        expect(v.transaction.invoked_address_hex).toBe(v.address_hex);
      });

      it("encodes the unsigned transaction, its preimage and its hash", () => {
        expect(toHex(serialize(tx, codec.Transaction))).toBe(
          v.transaction_xdr_hex,
        );
        expect(toHex(transactionSignaturePreimage(network, tx))).toBe(
          v.signing_preimage_hex,
        );
      });

      if (v.signature_rnd_hex === null) {
        it("reproduces the signed transaction byte for byte", async () => {
          const signed = await signTransaction(
            tx,
            [
              {
                signer,
                publicKeyId: BigInt(vectorFile.pubkey_claim_key_id),
              },
            ],
            network,
          );
          expect(signed.pubkey_claim_key).toEqual(publicKey);
          const signature = signed.signatures[0]!.signature;
          expect(
            toHex(
              "ed25519" in signature ? signature.ed25519 : mlDsa65Of(signature),
            ),
          ).toBe(v.signature_hex);
          expect(toHex(serialize(signed, codec.SignedTransaction))).toBe(
            v.signed_transaction_xdr_hex,
          );
          expect(toHex(hashSignedTransaction(signed))).toBe(
            v.transaction_hash_hex,
          );
        });
      } else {
        // A hedged signature: the signer only makes fresh or zero `rnd`, so
        // sign with the vector's `rnd` directly, then check it slots into
        // the same signed transaction as its base.
        it("reproduces the re-signed transaction and keeps the hash", async () => {
          const base = vectorFile.vectors.find((b) => b.name === v.resign_of);
          expect(base).toBeDefined();
          const secretKey = ml_dsa65.keygen(fromHex(v.seed_hex)).secretKey;
          const signature = ml_dsa65.sign(
            fromHex(v.signing_preimage_hex),
            secretKey,
            { extraEntropy: fromHex(v.signature_rnd_hex!) },
          );
          expect(toHex(signature)).toBe(v.signature_hex);

          const signed = await signTransaction(
            tx,
            [
              {
                signer,
                publicKeyId: BigInt(vectorFile.pubkey_claim_key_id),
              },
            ],
            network,
          );
          expect(toHex(mlDsa65Of(signed.signatures[0]!.signature))).toBe(
            base!.signature_hex,
          );
          const resigned: SignedTransaction = {
            ...signed,
            signatures: [
              {
                ...signed.signatures[0]!,
                signature: {
                  scheme: CryptographicScheme.MlDsa65,
                  mldsa65: mlDsa65Signature(signature),
                },
              },
            ],
          };
          expect(toHex(serialize(resigned, codec.SignedTransaction))).toBe(
            v.signed_transaction_xdr_hex,
          );
          expect(v.signed_transaction_xdr_hex).not.toBe(
            base!.signed_transaction_xdr_hex,
          );
          expect(toHex(hashSignedTransaction(resigned))).toBe(
            base!.transaction_hash_hex,
          );
          expect(v.transaction_hash_hex).toBe(base!.transaction_hash_hex);
        });
      }
    },
  );
});
