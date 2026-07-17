import { codec, contractAddress } from "@groundhogchain/protocol";
import type {
  ContractAddress,
  PubkeyAccountPreimage,
} from "@groundhogchain/protocol";
import { PUBKEY_ACCOUNT } from "./domainSeparator.js";

/**
 * Derives the on-chain address of a pubkey account from its preimage:
 * `sha256( cxs(DomainSeparator("PubkeyAccount")) || cxs(preimage) )`.
 *
 * Mirrors `pubkey_account_address` in the Rust `groundhog-domain-separator`
 * crate; the two are pinned to each other by the golden vectors in
 * `specs/test-vectors/domain-separator.json`.
 *
 * @example
 * ```ts
 * import { derivePubkeyAccountAddress } from "@groundhogchain/client";
 * import { CryptographicScheme, ed25519PublicKey } from "@groundhogchain/protocol";
 *
 * const address = derivePubkeyAccountAddress({
 *   pubkey: { scheme: CryptographicScheme.Ed25519, ed25519: ed25519PublicKey(raw) },
 *   nonce: 0n,
 * });
 * ```
 */
export function derivePubkeyAccountAddress(
  preimage: PubkeyAccountPreimage,
): ContractAddress {
  return contractAddress(
    PUBKEY_ACCOUNT.hashObject(preimage, codec.PubkeyAccountPreimage),
  );
}
