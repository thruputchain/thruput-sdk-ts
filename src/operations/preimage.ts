import { sha256 } from "@noble/hashes/sha2.js";
import {
  CxsWriter,
  Int64Codec,
  Uint64Codec,
  sha256Hash,
} from "@groundhogchain/protocol";
import type {
  ContractAddress,
  NetworkHash,
  SHA256Hash,
} from "@groundhogchain/protocol";
import { SIGNED_OP } from "../derivation/domainSeparator.js";

/**
 * Bound on an operation body, matching the protocol's unbounded `Calldata`
 * (`BytesM`). An operation body is application calldata, and this layer has no
 * basis for a tighter bound than a call itself carries.
 */
const kMaxOperationBodyLen = 0xffffffff;

/** Bytes of fixed-width header before the first varint: two 32-byte hashes and
 * the 8-byte type ID. */
const kFixedPrefixLen = 32 + 32 + 8;

/**
 * A structured message authorizing an on-chain action, signed off-chain.
 *
 * Every field but `body` is a replay bound, and none is optional:
 *
 * | Field | Stops the signature being replayed |
 * |---|---|
 * | `network` | on another network carrying the same address |
 * | `verifyingContract` | against a different contract |
 * | `typeId` | as a different kind of message |
 * | `nonce` / `validUntil` | again, or forever |
 *
 * `typeId` is the one with no counterpart in a transaction signature, and the
 * one a hand-rolled scheme forgets. CXS concatenates struct fields with no
 * framing, so two application payloads with the same field types encode
 * identically — binding the type is what keeps a signature over one from being
 * a signature over the other.
 */
export interface SignedOperation {
  /** The network this operation is valid on. */
  readonly network: NetworkHash;
  /** The contract entitled to act on this operation. */
  readonly verifyingContract: ContractAddress;
  /** Which kind of operation this is; see `operationTypeId`. */
  readonly typeId: bigint;
  /** The signer's nonce this operation spends. */
  readonly nonce: bigint;
  /** Last block height at which this operation may execute. */
  readonly validUntil: bigint;
  /** The CXS-encoded application payload. */
  readonly body: Uint8Array;
}

function u64ToBigEndian(value: bigint, label: string): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new RangeError(`${label} must fit in a u64`);
  }
  const out = new Uint8Array(8);
  let remaining = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function requireLength(
  bytes: Uint8Array,
  expected: number,
  label: string,
): void {
  if (bytes.length !== expected) {
    throw new RangeError(
      `${label} must be ${expected} bytes, got ${bytes.length}`,
    );
  }
}

/**
 * The CXS encoding of an operation, without the domain-separator prefix.
 *
 * The first three fields are fixed-width — 32, 32 and 8 bytes — and the two
 * integers after them are CXS varints, which are self-delimiting, so the
 * body's start is unambiguous. The body is written last as a length-prefixed
 * var-opaque.
 *
 * Exported for tests and debugging; sign {@link signedOperationPreimage}.
 */
export function encodeSignedOperation(op: SignedOperation): Uint8Array {
  requireLength(op.network, 32, "network");
  requireLength(op.verifyingContract, 32, "verifyingContract");
  if (op.validUntil < -(2n ** 63n) || op.validUntil >= 2n ** 63n) {
    throw new RangeError("validUntil must fit in an i64");
  }

  const writer = new CxsWriter();
  Uint64Codec.encode(writer, op.nonce);
  Int64Codec.encode(writer, op.validUntil);
  writer.writeVarOpaque(op.body, kMaxOperationBodyLen);
  const tail = writer.finish();

  const out = new Uint8Array(kFixedPrefixLen + tail.length);
  out.set(op.network, 0);
  out.set(op.verifyingContract, 32);
  out.set(u64ToBigEndian(op.typeId, "typeId"), 64);
  out.set(tail, kFixedPrefixLen);
  return out;
}

/**
 * The exact bytes a signature covers:
 *
 * ```text
 * cxs(DomainSeparator("SignedOp::1"))
 *   || network || verifyingContract || typeId || nonce || validUntil
 *   || cxs(body)
 * ```
 *
 * Signed directly, with no pre-hash: Ed25519 hashes its own message, the same
 * call {@link transactionSignaturePreimage} makes. Must match the Rust
 * `SignedOp::preimage` byte for byte, or every signature is rejected;
 * `specs/test-vectors/signed-op.json` pins the two together.
 *
 * {@link signOperation} calls this; reach for it directly only when handing
 * bytes to a signer this package does not drive.
 */
export function signedOperationPreimage(op: SignedOperation): Uint8Array {
  return SIGNED_OP.preimage(encodeSignedOperation(op));
}

/**
 * A stable identifier for an operation: `sha256` of its
 * {@link signedOperationPreimage}.
 *
 * Use it to key nonce records, log, or deduplicate. Do not sign it — the
 * preimage is the message.
 */
export function signedOperationId(op: SignedOperation): SHA256Hash {
  return sha256Hash(sha256(signedOperationPreimage(op)));
}
