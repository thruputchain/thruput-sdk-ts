import { sha256 } from "@noble/hashes/sha2.js";
import { contractEntrypointID } from "@groundhogchain/protocol";
import type { ContractEntrypointID } from "@groundhogchain/protocol";

/**
 * The major-version domain a semver string belongs to.
 *
 * Mirrors the Rust SDK's `major_version_from_string`: a zero major or minor is
 * not a stable domain on its own, so the domain widens until it is.
 *
 * - `1.2.3` → `1`
 * - `0.9.2` → `0.9`
 * - `0.0.2` → `0.0.2`
 *
 * @throws If `versionStr` has fewer than three dot-separated components.
 */
export function majorVersionFromSemver(versionStr: string): string {
  const parts = versionStr.split(".");
  if (parts.length < 3) throw new Error(`Invalid semver: ${versionStr}`);
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);
  if (major > 0) return `${major}`;
  if (minor > 0) return `${major}.${minor}`;
  if (patch > 0) return `${major}.${minor}.${patch}`;
  return versionStr;
}

/** Domain used when a method has no interface name. */
const kUnnamedInterface = "_unnamed_interface";

/**
 * `sha256(a :: b :: c)[0..8]`, the 8-byte selector derivation shared by
 * {@link deriveEntrypointID} and {@link operationTypeId}.
 *
 * The literal `::` separators are what keep field boundaries unambiguous —
 * without them interface `Foo1` with major `2` and interface `Foo` with major
 * `12` would hash identically. Fields are raw UTF-8, not XDR-encoded. The Rust
 * side shares one code path here too (`selector_from_triple`), so the two
 * derivations cannot drift apart.
 */
function selectorFromTriple(a: string, b: string, c: string): Uint8Array {
  const combined = new TextEncoder().encode(`${a}::${b}::${c}`);
  return sha256(combined).slice(0, 8);
}

/**
 * The 8-byte entrypoint ID for a contract method:
 * `sha256(interface :: majorVersion :: method)[0..8]`.
 *
 * A null `interfaceName` uses the `_unnamed_interface` domain. The literal `::`
 * separators are what keep field boundaries unambiguous — without them
 * interface `Foo1` with major `2` and interface `Foo` with major `12` would
 * hash identically. Fields are raw UTF-8, not XDR-encoded.
 *
 * Matches the Rust SDK's `contract_entrypoint_id`.
 */
export function deriveEntrypointID(
  interfaceName: string | null,
  versionStr: string,
  methodName: string,
): ContractEntrypointID {
  return contractEntrypointID(
    selectorFromTriple(
      interfaceName ?? kUnnamedInterface,
      majorVersionFromSemver(versionStr),
      methodName,
    ),
  );
}

/**
 * The type ID for a signed operation, as a big-endian `u64`:
 * `sha256(interface :: majorVersion :: operationName)[0..8]`.
 *
 * This is {@link deriveEntrypointID}'s derivation on the same code path, so an
 * operation named after the method it authorizes gets that method's ID. The two
 * are never compared and never share a position — an entrypoint ID routes a
 * call, an operation type ID sits inside a signature preimage — so the
 * coincidence is a convenience, not a constraint.
 *
 * Returned as a `bigint` because that is how it travels on the wire, in the
 * `Operation.type_id` field the contract reads. Mirrors the Rust
 * `operation_type_id`.
 *
 * @example
 * ```ts
 * const transfer = operationTypeId("MyWallet", "0.1.0", "transfer");
 * ```
 */
export function operationTypeId(
  interfaceName: string | null,
  versionStr: string,
  operationName: string,
): bigint {
  const bytes = selectorFromTriple(
    interfaceName ?? kUnnamedInterface,
    majorVersionFromSemver(versionStr),
    operationName,
  );
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}
