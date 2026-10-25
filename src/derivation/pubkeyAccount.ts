import { codec, contractAddress } from "@thruputchain/protocol";
import type {
  ContractAddress,
  PubkeyAccountPreimage,
  PublicKey,
} from "@thruputchain/protocol";
import { PUBKEY_ACCOUNT } from "./domainSeparator.js";
import { derivePublicKeyHash } from "./publicKeyHash.js";

/**
 * Builds the preimage of a pubkey account's address from its key and nonce:
 * `{ pubkey_hash: derivePublicKeyHash(pubkey), nonce }`.
 *
 * The preimage names the key by its scheme-inclusive hash for every scheme,
 * Ed25519 included, so it is the same size whatever the key.
 */
export function pubkeyAccountPreimage(
  pubkey: PublicKey,
  nonce: bigint = 0n,
): PubkeyAccountPreimage {
  return { pubkey_hash: derivePublicKeyHash(pubkey), nonce };
}

/**
 * Derives the on-chain address of a pubkey account from its preimage:
 * `sha256( cxs(DomainSeparator("PubkeyAccount")) || cxs(preimage) )`.
 *
 * Mirrors `pubkey_account_address` in the Rust `thruput-domain-separator`
 * crate; the two are pinned to each other by the golden vectors in
 * `specs/test-vectors/domain-separator.json`.
 *
 * @example
 * ```ts
 * import {
 *   derivePubkeyAccountAddress,
 *   pubkeyAccountPreimage,
 * } from "@thruputchain/client";
 *
 * const address = derivePubkeyAccountAddress(
 *   pubkeyAccountPreimage(signer.publicKey, 0n),
 * );
 * ```
 */
export function derivePubkeyAccountAddress(
  preimage: PubkeyAccountPreimage,
): ContractAddress {
  return contractAddress(
    PUBKEY_ACCOUNT.hashObject(preimage, codec.PubkeyAccountPreimage),
  );
}
