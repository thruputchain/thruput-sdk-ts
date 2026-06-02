import type { Transport } from "../../transport/types.js";
import type { VersionInfo } from "../../types/rpc.js";

export async function getVersion(transport: Transport): Promise<VersionInfo> {
  const result = await transport.request<{
    wireFormat: string;
    implementation: string;
    commitHash?: string | null;
  }>("groundhog_version");
  return {
    wireFormat: result.wireFormat,
    implementation: result.implementation,
    commitHash: result.commitHash ?? null,
  };
}
