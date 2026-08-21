import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toHex0x } from "../index.js";
import { loadLocalDevAccount } from "./index.js";

const seed = "groundhog-dev-accounts";
const publicKeys = [
  "591ff2bdaaf5a0cbfd31f7b0f88c1ddee39fd9e106ba46303bde718459960633",
  "f5495b73debe0193757220005043944a3f03ff20cea7c4559db158eb1389e93f",
  "b8c09ac34f6c3ff58ddb549b19751d4e8b52f217fe6138f47322989c55a279a5",
] as const;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("loadLocalDevAccount", () => {
  it("selects the lowest-index account marked as a local user", async () => {
    const fixture = await writeRuntimeFixture([
      makeAccount(2, "local_user"),
      makeAccount(0, "local_user"),
      makeAccount(1, "local_user"),
    ]);

    const account = await loadLocalDevAccount({ env: fixture.env });

    expect(account.index).toBe(0);
    expect(toHex0x(account.address)).toBe(`0x${"00".repeat(32)}`);
    expect(account.rpcUrl).toBe("http://127.0.0.1:9545");
  });

  it("selects later local users by offset", async () => {
    const fixture = await writeRuntimeFixture([
      makeAccount(0, "faucet"),
      makeAccount(1, "local_user"),
      makeAccount(2, "local_user"),
    ]);

    const account = await loadLocalDevAccount({
      localUserOffset: 1,
      env: fixture.env,
    });

    expect(account.index).toBe(2);
    expect(toHex0x(account.address)).toBe(`0x${"02".repeat(32)}`);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid local user offset %s",
    async (localUserOffset) => {
      await expect(loadLocalDevAccount({ localUserOffset })).rejects.toThrow(
        "localUserOffset must be a non-negative integer",
      );
    },
  );

  it("supports manifest and RPC environment overrides", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);
    const overrideManifest = join(fixture.root, "override-manifest.json");
    await writeFile(
      overrideManifest,
      JSON.stringify(makeManifest([makeAccount(2, "local_user")])),
    );

    const account = await loadLocalDevAccount({
      env: {
        ...fixture.env,
        GROUNDHOG_RUNTIME_MANIFEST: overrideManifest,
        GROUNDHOG_RPC_URL: "http://127.0.0.1:9999",
      },
    });

    expect(account.index).toBe(2);
    expect(account.rpcUrl).toBe("http://127.0.0.1:9999");
  });

  it("supports a manifest override with the configured RPC URL", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);
    const overrideManifest = join(fixture.root, "override-manifest.json");
    await writeFile(
      overrideManifest,
      JSON.stringify(makeManifest([makeAccount(2, "local_user")])),
    );

    const account = await loadLocalDevAccount({
      env: {
        ...fixture.env,
        GROUNDHOG_RUNTIME_MANIFEST: overrideManifest,
      },
    });

    expect(account.index).toBe(2);
    expect(account.rpcUrl).toBe("http://127.0.0.1:9545");
  });

  it("supports an RPC override with the configured manifest", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);

    const account = await loadLocalDevAccount({
      env: {
        ...fixture.env,
        GROUNDHOG_RPC_URL: "http://127.0.0.1:9999",
      },
    });

    expect(account.index).toBe(1);
    expect(account.rpcUrl).toBe("http://127.0.0.1:9999");
  });

  it("treats blank environment overrides as absent", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);

    const account = await loadLocalDevAccount({
      env: {
        ...fixture.env,
        GROUNDHOG_RUNTIME_MANIFEST: "  ",
        GROUNDHOG_RPC_URL: "",
      },
    });

    expect(account.index).toBe(1);
    expect(account.rpcUrl).toBe("http://127.0.0.1:9545");
  });

  it("uses the HOME config directory when XDG_CONFIG_HOME is unset", async () => {
    const fixture = await writeRuntimeFixture(
      [makeAccount(1, "local_user")],
      true,
    );

    const account = await loadLocalDevAccount({ env: fixture.env });

    expect(account.index).toBe(1);
  });

  it("uses the HOME config directory when XDG_CONFIG_HOME is blank", async () => {
    const fixture = await writeRuntimeFixture(
      [makeAccount(1, "local_user")],
      true,
    );

    const account = await loadLocalDevAccount({
      env: { ...fixture.env, XDG_CONFIG_HOME: "  " },
    });

    expect(account.index).toBe(1);
  });

  it("uses a relative XDG_CONFIG_HOME like the Groundhog CLI", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);

    const account = await loadLocalDevAccount({
      env: { XDG_CONFIG_HOME: relative(process.cwd(), fixture.root) },
    });

    expect(account.index).toBe(1);
  });

  it("accepts complete script overrides without a config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "groundhog-client-local-dev-"));
    tempDirs.push(root);
    const manifestPath = join(root, "runtime-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest([makeAccount(1, "local_user")])),
    );

    const account = await loadLocalDevAccount({
      env: {
        XDG_CONFIG_HOME: join(root, "missing"),
        GROUNDHOG_RUNTIME_MANIFEST: relative(process.cwd(), manifestPath),
        GROUNDHOG_RPC_URL: "http://127.0.0.1:9999",
      },
    });

    expect(account.index).toBe(1);
    expect(account.rpcUrl).toBe("http://127.0.0.1:9999");
  });

  it("rejects a manifest whose public key does not match its index", async () => {
    const invalid = makeAccount(1, "local_user");
    invalid.publicKey = `0x${"ff".repeat(32)}`;
    const fixture = await writeRuntimeFixture([invalid]);

    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Derived key does not match local user dev-1",
    );
  });

  it("rejects unsupported manifests and derivation schemes", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);
    const manifest = makeManifest([makeAccount(1, "local_user")]);

    await writeFile(
      fixture.manifestPath,
      JSON.stringify({ ...manifest, schemaVersion: 1 }),
    );
    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Unsupported Groundhog runtime manifest",
    );

    await writeFile(
      fixture.manifestPath,
      JSON.stringify({ ...manifest, kind: "future-runtime" }),
    );
    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Unsupported Groundhog runtime manifest",
    );

    await writeFile(
      fixture.manifestPath,
      JSON.stringify({
        ...manifest,
        bootstrapAccountDerivation: {
          ...manifest.bootstrapAccountDerivation,
          scheme: "future-scheme",
        },
      }),
    );
    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Unsupported local account derivation scheme: future-scheme",
    );
  });

  it("rejects derivation indices outside the manifest's u32 range", async () => {
    const account = makeAccount(1, "local_user");
    account.index = 0x1_0000_0000;
    const fixture = await writeRuntimeFixture([account]);

    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Local user has an invalid derivation index",
    );
  });

  it("rejects runtime manifests larger than one MiB", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);
    await writeFile(fixture.manifestPath, " ".repeat(1024 * 1024 + 1));

    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Groundhog runtime manifest exceeds 1048576 bytes",
    );
  });

  it.each([undefined, "", "  "])(
    "reports when HOME is unavailable or blank (%j)",
    async (home) => {
      await expect(
        loadLocalDevAccount({
          env: {
            HOME: home,
            GROUNDHOG_RPC_URL: "http://127.0.0.1:9545",
          },
        }),
      ).rejects.toThrow("HOME environment variable is not set");
    },
  );

  it("reports when no active local runtime is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "groundhog-client-local-dev-"));
    tempDirs.push(root);

    await expect(
      loadLocalDevAccount({ env: { XDG_CONFIG_HOME: root } }),
    ).rejects.toThrow("Groundhog config is unavailable");
  });
});

interface FixtureAccount {
  index: number;
  role: string;
  publicKey: string;
  walletAddress: string;
}

function makeAccount(index: number, role: string): FixtureAccount {
  const publicKey = publicKeys[index];
  if (!publicKey)
    throw new Error(`Missing public-key fixture for dev-${index}`);
  return {
    index,
    role,
    publicKey: `0x${publicKey}`,
    walletAddress: `0x${index.toString(16).padStart(2, "0").repeat(32)}`,
  };
}

function makeManifest(accounts: FixtureAccount[]) {
  return {
    schemaVersion: 2,
    kind: "hogd-dev-runtime",
    bootstrapAccountDerivation: {
      scheme: "groundhog-bootstrap-account-v1",
      seed,
    },
    bootstrapAccounts: accounts,
  };
}

async function writeRuntimeFixture(
  accounts: FixtureAccount[],
  useHome = false,
) {
  const root = await mkdtemp(join(tmpdir(), "groundhog-client-local-dev-"));
  tempDirs.push(root);
  const configHome = useHome ? join(root, ".config") : root;
  const configDir = join(configHome, "groundhog");
  const manifestPath = join(root, "runtime-manifest.json");
  await mkdir(configDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(makeManifest(accounts)));
  await writeFile(
    join(configDir, "config.toml"),
    `[local_runtime_state]\nrpc_url = "http://127.0.0.1:9545"\nruntime_manifest = "${manifestPath}"\n`,
  );
  return {
    root,
    manifestPath,
    env: useHome ? { HOME: root } : { XDG_CONFIG_HOME: root },
  };
}
