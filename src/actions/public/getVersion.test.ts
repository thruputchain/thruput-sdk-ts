import { describe, expect, it } from "vitest";
import { createThruputClient } from "../../client.js";
import { HttpTransport } from "../../transport/http.js";

const base = { wireFormat: "3.3.0", implementation: "gateway" };
async function readVersion(fields: Record<string, unknown>) {
  const client = await createThruputClient({
    transport: new HttpTransport("https://rpc.example", {
      fetch: async () =>
        Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { ...base, ...fields },
        }),
    }),
  });
  return client.getVersion();
}

describe("release identity", () => {
  it("preserves the release and manifest digest from the RPC", async () => {
    await expect(
      readVersion({
        releaseVersion: "0.1.25-rc.5",
        bundleManifestDigest: "sha256:manifest",
      }),
    ).resolves.toMatchObject({
      releaseVersion: "0.1.25-rc.5",
      bundleManifestDigest: "sha256:manifest",
    });
  });

  it.each([undefined, null])(
    "normalizes absent identity (%s) to null",
    async (value) => {
      await expect(
        readVersion({ releaseVersion: value, bundleManifestDigest: value }),
      ).resolves.toMatchObject({
        releaseVersion: null,
        bundleManifestDigest: null,
      });
    },
  );

  for (const field of [
    "commitHash",
    "platformVersion",
    "releaseVersion",
    "bundleManifestDigest",
  ]) {
    it.each([1, false, {}, []])(
      `rejects malformed ${field}: %j`,
      async (value) => {
        await expect(readVersion({ [field]: value })).rejects.toThrow(
          `expected ${field}`,
        );
      },
    );
  }
});
