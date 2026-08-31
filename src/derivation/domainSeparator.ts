import { sha256 } from "@noble/hashes/sha2.js";
import {
  CxsWriter,
  codec,
  serializeCxs,
  sha256Hash,
} from "@groundhogchain/protocol";
import type { SHA256Hash } from "@groundhogchain/protocol";
import type { XdrCodec } from "@groundhogchain/xdr";

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

  /**
   * Builds the separator for an application's own signing domain, folding
   * `version` into the name as `"<app>::<version>"`.
   *
   * The version is the schema version of the messages signed under this
   * separator, and exists to be bumped: `"MyApp::1"` and `"MyApp::2"` are
   * different domains, so bumping retires every signature made under the old
   * schema at once.
   *
   * It rides inside the name rather than as its own protocol field because
   * `DomainSeparator` is shared with the validator — a new field would change
   * every separator's encoding, moving every pubkey account address and
   * invalidating every in-flight transaction signature. Mirrors the Rust
   * `domain_separator!(NAME = "MyApp" version "1")` macro.
   */
  static versioned(app: string, version: string): DomainSeparator {
    return DomainSeparator.make(`${app}::${version}`);
  }

  /**
   * `prefix || objectCxs` — the preimage bytes themselves.
   *
   * This is what a signature covers when an object is *signed* rather than
   * hashed into an identifier; Ed25519 hashes its own message, so there is no
   * pre-hash. See `signedOperationPreimage`.
   */
  preimage(objectCxs: Uint8Array): Uint8Array {
    const preimage = new Uint8Array(this.bytes.length + objectCxs.length);
    preimage.set(this.bytes, 0);
    preimage.set(objectCxs, this.bytes.length);
    return preimage;
  }

  /** `sha256(prefix || objectCxs)` over already-CXS-encoded object bytes. */
  hash(objectCxs: Uint8Array): SHA256Hash {
    return sha256Hash(sha256(this.preimage(objectCxs)));
  }

  /** `sha256(prefix || cxs(value))`, serializing `value` with `objectCodec`. */
  hashObject<T>(value: T, objectCodec: XdrCodec<T>): SHA256Hash {
    return this.hash(serializeCxs(value, objectCodec));
  }
}

/** Domain separator for pubkey account address derivation. */
export const PUBKEY_ACCOUNT: DomainSeparator =
  DomainSeparator.make("PubkeyAccount");

/**
 * Domain separator for signed operations.
 *
 * Versioned (`"SignedOp::1"`) because the envelope's own shape may change;
 * individual operations are told apart *within* this domain by their operation
 * type ID, not by separate separators. Mirrors the Rust `SIGNED_OP`.
 */
export const SIGNED_OP: DomainSeparator = DomainSeparator.versioned(
  "SignedOp",
  "1",
);

/**
 * Domain separator for transaction signature preimages.
 *
 * Unlike {@link PUBKEY_ACCOUNT} this one prefixes a message that is signed
 * directly rather than hashed, so it is used through its {@link
 * DomainSeparator.bytes} rather than `hash` / `hashObject`. See
 * `transactionSignaturePreimage`.
 */
export const TRANSACTION: DomainSeparator = DomainSeparator.make("Transaction");
