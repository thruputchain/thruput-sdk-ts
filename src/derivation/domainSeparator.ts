import { sha256 } from "@noble/hashes/sha2.js";
import {
  CxsWriter,
  codec,
  serializeCxs,
  sha256Hash,
} from "@thruputchain/protocol";
import type { SHA256Hash } from "@thruputchain/protocol";
import type { XdrCodec } from "@thruputchain/xdr";

/**
 * Maximum UTF-8 length of a domain-separator name, from the protocol's
 * `DomainSeparator.domain_separator: opaque<256>` bound.
 */
const kMaxNameLen = 256;

/**
 * A domain separator: the precomputed CXS bytes of the protocol
 * `DomainSeparator { ext: 0, domain_separator: <name> }`, used to prefix hash
 * preimages so hashes from different domains can never collide.
 *
 * Mirrors the Rust `groundhog-domain-separator` crate. Module-internal: the
 * public API exposes only the derived-address helpers built on top of it.
 */
export class DomainSeparator {
  private constructor(readonly bytes: Uint8Array) {}

  /**
   * Builds the separator for `name`, CXS-encoding it through the same
   * `ExtensionPoint` codec the protocol uses.
   *
   * @throws If the UTF-8 encoding of `name` exceeds 256 bytes (the protocol's
   * `opaque<256>` bound).
   */
  static make(name: string): DomainSeparator {
    const nameBytes = new TextEncoder().encode(name);
    if (nameBytes.length > kMaxNameLen) {
      throw new Error(
        `Domain separator name is ${nameBytes.length} UTF-8 bytes; the protocol bound is ${kMaxNameLen}`,
      );
    }
    const ext = serializeCxs({ v: 0 }, codec.ExtensionPoint);
    const writer = new CxsWriter();
    writer.writeVarOpaque(nameBytes, kMaxNameLen);
    const opaque = writer.finish();
    const bytes = new Uint8Array(ext.length + opaque.length);
    bytes.set(ext, 0);
    bytes.set(opaque, ext.length);
    return new DomainSeparator(bytes);
  }

  /** `sha256(prefix || objectCxs)` over already-CXS-encoded object bytes. */
  hash(objectCxs: Uint8Array): SHA256Hash {
    const preimage = new Uint8Array(this.bytes.length + objectCxs.length);
    preimage.set(this.bytes, 0);
    preimage.set(objectCxs, this.bytes.length);
    return sha256Hash(sha256(preimage));
  }

  /** `sha256(prefix || cxs(value))`, serializing `value` with `objectCodec`. */
  hashObject<T>(value: T, objectCodec: XdrCodec<T>): SHA256Hash {
    return this.hash(serializeCxs(value, objectCodec));
  }
}

/**
 * Domain separator for public-key hashes (`"PublicKey"`): a `PublicKeyHash` is
 * `sha256(cxs(DomainSeparator("PublicKey")) || cxs(PublicKey))`.
 */
export const PUBLIC_KEY: DomainSeparator = DomainSeparator.make("PublicKey");

/** Domain separator for pubkey account address derivation. */
export const PUBKEY_ACCOUNT: DomainSeparator =
  DomainSeparator.make("PubkeyAccount");

/**
 * Domain separator for transaction signature preimages.
 *
 * Unlike {@link PUBKEY_ACCOUNT} this one prefixes a message that is signed
 * directly rather than hashed, so it is used through its {@link
 * DomainSeparator.bytes} rather than `hash` / `hashObject`. See
 * `transactionSignaturePreimage`.
 */
export const TRANSACTION: DomainSeparator = DomainSeparator.make("Transaction");

/**
 * Domain separator for signed operations (`"SignedOp"`).
 *
 * Like {@link TRANSACTION} it prefixes a message that is signed directly; see
 * `signedOperationPreimage`.
 */
export const SIGNED_OP: DomainSeparator = DomainSeparator.make("SignedOp");
