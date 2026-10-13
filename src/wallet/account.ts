import {
  AuthClaimType,
  CryptographicScheme,
  bitMap,
  contractAddress,
  ed25519PublicKey,
  kMaxSigners,
  weight,
  type AuthClaim,
  type BitMap,
  type ContractAddress,
  type Weight,
} from "@thruputchain/protocol";
import type { Signer } from "../signers/types.js";
import type { SignerEntry } from "../transaction/sign.js";
import { derivePubkeyAccountAddress } from "../derivation/pubkeyAccount.js";

const uint32Max = 0xffff_ffffn;
const uint64Max = 0xffff_ffff_ffff_ffffn;
const sourceAddressKeyMask = (1n << kMaxSigners) - 1n;

interface WalletAccountBase {
  readonly address: ContractAddress;
  readonly authClaim: AuthClaim;
  readonly signers: readonly SignerEntry[];
}

/** Protocol pubkey account authorized directly by one Ed25519 key. */
export interface PubkeyAccount extends WalletAccountBase {
  readonly kind: "pubkey";
  readonly nonce: bigint;
  readonly authClaim: Extract<
    AuthClaim,
    { claim_type: AuthClaimType.kPubkeySignature }
  >;
}

/** Existing account contract authorized through source-address auth data. */
export interface SourceAddressAccount extends WalletAccountBase {
  readonly kind: "sourceAddress";
  readonly authClaim: Extract<
    AuthClaim,
    { claim_type: AuthClaimType.kSourceAddressAuthData }
  >;
}

/** Account configuration accepted by {@link createWalletClient}. */
export type WalletAccount = PubkeyAccount | SourceAddressAccount;

/** Options for {@link createPubkeyAccount}. */
export interface CreatePubkeyAccountOptions {
  readonly signer: Signer;
  /** Address-derivation nonce. Defaults to zero. */
  readonly nonce?: bigint;
}

/** Options for {@link createSourceAddressAccount}. */
export interface CreateSourceAddressAccountOptions {
  readonly address: ContractAddress;
  readonly signers: readonly SignerEntry[];
  readonly allowedKeys: BitMap;
  readonly requiredWeight: Weight;
}

/** Create a protocol `kPubkeySignature` account. */
export function createPubkeyAccount(
  options: CreatePubkeyAccountOptions,
): PubkeyAccount {
  validateSigner(options.signer);
  const nonce = options.nonce ?? 0n;
  validateUnsigned(nonce, uint64Max, "nonce");
  if (options.signer.publicKey.scheme !== CryptographicScheme.Ed25519) {
    throw new Error("Pubkey accounts require an Ed25519 signer");
  }

  const publicKey = {
    scheme: CryptographicScheme.Ed25519,
    ed25519: ed25519PublicKey(new Uint8Array(options.signer.publicKey.ed25519)),
  } as const;
  const preimage = { pubkey: publicKey, nonce };

  return {
    kind: "pubkey",
    address: derivePubkeyAccountAddress(preimage),
    nonce,
    authClaim: {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: preimage,
    },
    signers: Object.freeze([
      Object.freeze({ signer: options.signer, publicKeyId: 0n }),
    ]),
  };
}

/** Create an account using the protocol's `kSourceAddressAuthData` mode. */
export function createSourceAddressAccount(
  options: CreateSourceAddressAccountOptions,
): SourceAddressAccount {
  if (options.address.length !== 32) {
    throw new RangeError("address must be 32 bytes");
  }
  validateUnsigned(options.allowedKeys, sourceAddressKeyMask, "allowedKeys");
  if (options.allowedKeys === 0n) {
    throw new RangeError("allowedKeys must select at least one key");
  }
  validateUnsigned(options.requiredWeight, uint32Max, "requiredWeight");
  if (options.signers.length === 0 || options.signers.length > kMaxSigners) {
    throw new RangeError(
      `signers must contain between 1 and ${kMaxSigners} entries`,
    );
  }

  const ids = new Set<bigint>();
  const signers = options.signers
    .map((entry) => {
      validateSigner(entry.signer);
      validateUnsigned(entry.publicKeyId, kMaxSigners - 1n, "publicKeyId");
      if (ids.has(entry.publicKeyId)) {
        throw new Error(`Duplicate publicKeyId: ${entry.publicKeyId}`);
      }
      if ((options.allowedKeys & (1n << entry.publicKeyId)) === 0n) {
        throw new Error(
          `publicKeyId ${entry.publicKeyId} is not selected by allowedKeys`,
        );
      }
      ids.add(entry.publicKeyId);
      return { signer: entry.signer, publicKeyId: entry.publicKeyId };
    })
    .sort((left, right) => (left.publicKeyId < right.publicKeyId ? -1 : 1));

  return {
    kind: "sourceAddress",
    address: contractAddress(new Uint8Array(options.address)),
    authClaim: {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(options.allowedKeys),
        required_weight: weight(options.requiredWeight),
      },
    },
    signers: Object.freeze(signers.map((entry) => Object.freeze(entry))),
  };
}

function validateSigner(signer: Signer): void {
  if (
    !signer ||
    typeof signer.sign !== "function" ||
    !signer.publicKey ||
    typeof signer.publicKey !== "object"
  ) {
    throw new Error("Invalid signer");
  }
}

function validateUnsigned(value: bigint, max: bigint, name: string): void {
  if (typeof value !== "bigint" || value < 0n || value > max) {
    throw new RangeError(`${name} must be between 0 and ${max}`);
  }
}
