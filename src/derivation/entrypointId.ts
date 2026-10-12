import { sha256 } from "@noble/hashes/sha2.js";
import { contractEntrypointID } from "@thruputchain/protocol";
import type { ContractEntrypointID } from "@thruputchain/protocol";

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
  const [majorPart, minorPart, patchPart] = versionStr.split(".");
  if (
    majorPart === undefined ||
    minorPart === undefined ||
    patchPart === undefined
  ) {
    throw new Error(`Invalid semver: ${versionStr}`);
  }
  const major = parseInt(majorPart, 10);
  const minor = parseInt(minorPart, 10);
  const patch = parseInt(patchPart, 10);
  if (major > 0) return `${major}`;
  if (minor > 0) return `${major}.${minor}`;
  if (patch > 0) return `${major}.${minor}.${patch}`;
  return versionStr;
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
  const name = interfaceName ?? "_unnamed_interface";
  const majorVersion = majorVersionFromSemver(versionStr);
  const combined = new TextEncoder().encode(
    `${name}::${majorVersion}::${methodName}`,
  );
  return contractEntrypointID(sha256(combined).slice(0, 8));
}
