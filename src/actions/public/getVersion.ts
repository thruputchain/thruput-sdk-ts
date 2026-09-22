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
  if (version.commitHash !== undefined && version.commitHash !== null) {
    if (typeof version.commitHash !== "string") {
      throw new Error("Invalid version response: expected commitHash");
    }
  }
  if (
    version.platformVersion !== undefined &&
    version.platformVersion !== null
  ) {
    if (typeof version.platformVersion !== "string") {
      throw new Error("Invalid version response: expected platformVersion");
    }
  }

  return {
    wireFormat: version.wireFormat,
    implementation: version.implementation,
    commitHash: version.commitHash ?? null,
    platformVersion: version.platformVersion ?? null,
  };
}
