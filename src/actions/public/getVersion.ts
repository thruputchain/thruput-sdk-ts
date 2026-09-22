import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type { VersionInfo } from "../../types/rpc.js";

/** Return the gateway implementation and wire-format version. */
export async function getVersion(
  transport: Transport,
  options?: TransportRequestOptions,
): Promise<VersionInfo> {
  options?.signal?.throwIfAborted();
  const result = await transport.request<unknown>(
    "groundhog_version",
    undefined,
    options,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid version response");
  }

  const version = result as Record<string, unknown>;
  if (typeof version.wireFormat !== "string") {
    throw new Error("Invalid version response: expected wireFormat");
  }
  if (typeof version.implementation !== "string") {
    throw new Error("Invalid version response: expected implementation");
  }
  return {
    wireFormat: version.wireFormat,
    implementation: version.implementation,
    commitHash: optionalString(version, "commitHash"),
    platformVersion: optionalString(version, "platformVersion"),
    releaseVersion: optionalString(version, "releaseVersion"),
    bundleManifestDigest: optionalString(version, "bundleManifestDigest"),
  };
}

function optionalString(
  version: Record<string, unknown>,
  field: string,
): string | null {
  const value = version[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid version response: expected ${field}`);
  }
  return value;
}
