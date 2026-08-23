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
      makeAccount(0, "faucet"),
      makeAccount(1, "local_user"),
    ]);

    const account = await loadLocalDevAccount({ env: fixture.env });

    expect(account.index).toBe(1);
    expect(account.keyName).toBe("dev-1");
    expect(account.role).toBe("local_user");
    expect(toHex0x(account.address)).toBe(`0x${"01".repeat(32)}`);
  });

  it("selects the faucet account", async () => {
    const fixture = await writeRuntimeFixture([
      makeAccount(1, "local_user"),
      makeAccount(0, "faucet"),
    ]);

    const account = await loadLocalDevAccount({
      role: "faucet",
      env: fixture.env,
    });

    expect(account.index).toBe(0);
    expect(account.keyName).toBe("dev-0");
    expect(account.role).toBe("faucet");
    expect(toHex0x(account.address)).toBe(`0x${"00".repeat(32)}`);
  });

  it("reports when the requested role is unavailable", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);

    await expect(
      loadLocalDevAccount({ role: "faucet", env: fixture.env }),
    ).rejects.toThrow(
      "Groundhog runtime manifest does not contain faucet account 1",
    );
  });

  it("selects later local users by offset", async () => {
    const fixture = await writeRuntimeFixture([
      makeAccount(0, "faucet"),
      makeAccount(1, "local_user"),
      makeAccount(2, "local_user"),
    ]);

    const account = await loadLocalDevAccount({
      roleOffset: 1,
      env: fixture.env,
    });

    expect(account.index).toBe(2);
    expect(toHex0x(account.address)).toBe(`0x${"02".repeat(32)}`);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid role offset %s",
    async (roleOffset) => {
      await expect(loadLocalDevAccount({ roleOffset })).rejects.toThrow(
        "roleOffset must be a non-negative integer",
      );
    },
  );

  it("supports a relative manifest override without a config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "groundhog-client-local-dev-"));
    tempDirs.push(root);
    const overrideManifest = join(root, "override-manifest.json");
    await writeFile(
      overrideManifest,
      JSON.stringify(makeManifest([makeAccount(2, "local_user")])),
    );

    const account = await loadLocalDevAccount({
      env: {
        GROUNDHOG_RUNTIME_MANIFEST: relative(process.cwd(), overrideManifest),
      },
    });

    expect(account.index).toBe(2);
  });

  it("treats a blank manifest override as absent", async () => {
    const fixture = await writeRuntimeFixture([makeAccount(1, "local_user")]);

    const account = await loadLocalDevAccount({
      env: {
        ...fixture.env,
        GROUNDHOG_RUNTIME_MANIFEST: "  ",
      },
    });

    expect(account.index).toBe(1);
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

  it("rejects a manifest whose public key does not match its index", async () => {
    const invalid = makeAccount(1, "local_user");
    invalid.publicKey = `0x${"ff".repeat(32)}`;
    const fixture = await writeRuntimeFixture([invalid]);

    await expect(loadLocalDevAccount({ env: fixture.env })).rejects.toThrow(
      "Derived key does not match dev-1",
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
      "Bootstrap account has an invalid derivation index",
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
          env: { HOME: home },
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

// Bare hex, no 0x prefix — how `hog-devnode` writes it into the manifest.
const fixtureNetworkHash = "5a".repeat(32);

function makeManifest(accounts: FixtureAccount[]) {
  return {
    schemaVersion: 2,
    kind: "hogd-dev-runtime",
    networkHash: fixtureNetworkHash,
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
    `[local_runtime_state]\nruntime_manifest = "${manifestPath}"\n`,
  );
  return {
    root,
    manifestPath,
    env: useHome ? { HOME: root } : { XDG_CONFIG_HOME: root },
  };
}
