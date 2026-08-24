import { afterEach, describe, expect, it, vi } from "vitest";
import openrpcSpec from "../specs/openrpc.json";
import { SUPPORTED_WIRE_FORMAT, assertCompatibleGateway } from "./version.js";
import type { VersionInfo } from "./types/rpc.js";

function clientReporting(wireFormat: string): {
  getVersion(): Promise<VersionInfo>;
} {
  return {
    async getVersion() {
      return { wireFormat, implementation: "test", commitHash: null };
    },
  };
}

describe("SUPPORTED_WIRE_FORMAT", () => {
  it("matches specs/openrpc.json info.version", () => {
    expect(SUPPORTED_WIRE_FORMAT).toBe(openrpcSpec.info.version);
  });
});

describe("assertCompatibleGateway", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the gateway version info on an exact match", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const version = await assertCompatibleGateway(
      clientReporting(SUPPORTED_WIRE_FORMAT),
    );

    expect(version.wireFormat).toBe(SUPPORTED_WIRE_FORMAT);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tolerates patch-version differences silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [major, minor] = SUPPORTED_WIRE_FORMAT.split(".");

    await assertCompatibleGateway(clientReporting(`${major}.${minor}.999`));

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on a minor-version mismatch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [major] = SUPPORTED_WIRE_FORMAT.split(".");

    await assertCompatibleGateway(clientReporting(`${major}.999.0`));

    expect(warn).toHaveBeenCalledOnce();
  });

  it("throws on a major-version mismatch", async () => {
    await expect(
      assertCompatibleGateway(clientReporting("999.0.0")),
    ).rejects.toThrow(/Incompatible gateway/);
  });

  it("throws on an unparseable wire format", async () => {
    await expect(
      assertCompatibleGateway(clientReporting("not-semver")),
    ).rejects.toThrow(/unparseable wireFormat/);
  });
});
