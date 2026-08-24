import type { VersionInfo } from "./types/rpc.js";

/**
 * Wire-format SemVer of the Groundhog OpenRPC spec this client targets.
 *
 * A unit test asserts this matches `info.version` in `specs/openrpc.json`;
 * bump both together when regenerating the pinned spec.
 */
export const SUPPORTED_WIRE_FORMAT = "2.3.1";

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(version: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Assert that a gateway speaks a wire format this client understands.
 *
 * Fetches `groundhog_version` and compares its `wireFormat` against
 * {@link SUPPORTED_WIRE_FORMAT}: throws on a major-version mismatch (or an
 * unparseable version), warns via `console.warn` on a minor-version mismatch,
 * and returns the gateway's version info on success. Opt-in — call it once at
 * startup when connecting to an untrusted or long-lived endpoint.
 */
export async function assertCompatibleGateway(client: {
  getVersion(): Promise<VersionInfo>;
}): Promise<VersionInfo> {
  const version = await client.getVersion();
  const actual = parseSemVer(version.wireFormat);
  if (!actual) {
    throw new Error(
      `Incompatible gateway: unparseable wireFormat "${version.wireFormat}" ` +
        `(client supports ${SUPPORTED_WIRE_FORMAT})`,
    );
  }
  const supported = parseSemVer(SUPPORTED_WIRE_FORMAT);
  if (!supported) {
    throw new Error("bug: SUPPORTED_WIRE_FORMAT is not a valid SemVer");
  }
  if (actual.major !== supported.major) {
    throw new Error(
      `Incompatible gateway: wire format ${version.wireFormat} does not match ` +
        `supported major version ${SUPPORTED_WIRE_FORMAT}`,
    );
  }
  if (actual.minor !== supported.minor) {
    console.warn(
      `Gateway wire format ${version.wireFormat} differs from the supported ` +
        `${SUPPORTED_WIRE_FORMAT} in its minor version; some methods may be ` +
        `missing or additive-only.`,
    );
  }
  return version;
}
