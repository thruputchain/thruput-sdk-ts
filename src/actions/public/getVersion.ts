import type { Transport } from "../../transport/types.js";
import type { VersionInfo } from "../../types/rpc.js";

/** Return the gateway implementation and wire-format version. */
export async function getVersion(transport: Transport): Promise<VersionInfo> {
  const result = await transport.request<unknown>("groundhog_version");
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

  return {
    wireFormat: version.wireFormat,
    implementation: version.implementation,
    commitHash: version.commitHash ?? null,
  };
}
