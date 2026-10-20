import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";

const version =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function validateIntegrationVersions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Integration versions must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!["cli", "devnode", "wireFormat", "cliSourceCommit"].includes(key)) {
      throw new Error(`Unknown integration version field: ${key}`);
    }
  }
  for (const key of ["cli", "devnode", "wireFormat"]) {
    if (
      typeof value[key] !== "string" ||
      !version.test(value[key]) ||
      value[key] !== value[key].trim()
    ) {
      throw new Error(`${key} must be an exact version`);
    }
  }
  if (
    value.cliSourceCommit !== undefined &&
    (typeof value.cliSourceCommit !== "string" ||
      value.cliSourceCommit.length !== 40 ||
      !/^[0-9a-f]{40}$/.test(value.cliSourceCommit))
  ) {
    throw new Error("cliSourceCommit must be a full lowercase Git commit SHA");
  }
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const versions = validateIntegrationVersions(
    JSON.parse(
      readFileSync(new URL("integration-versions.json", import.meta.url)),
    ),
  );
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `cli=${versions.cli}\nsource-commit=${versions.cliSourceCommit ?? ""}\n`,
  );
}

/** Describe explicit qualification deviations; none can qualify a pinned CI run. */
export function integrationOverrides(versions, env) {
  const keys = [
    "THRUPUT_DEVNODE_BINARY",
    "HOGD_PROTOCOL_OVERRIDE",
    "THRUPUT_EXPECTED_WIRE_FORMAT",
  ];
  const selected = keys.filter((key) => env[key] !== undefined);
  if (selected.length && (env.CI || env.GITHUB_ACTIONS)) {
    throw new Error(
      `Qualification overrides are not allowed in CI: ${selected.join(", ")}`,
    );
  }
  if (selected.length && env.THRUPUT_ALLOW_LOCAL_CANDIDATE !== "1") {
    throw new Error(
      "Qualification overrides require explicit local candidate mode",
    );
  }
  for (const key of selected) {
    if (
      typeof env[key] !== "string" ||
      env[key].length === 0 ||
      env[key] !== env[key].trim()
    ) {
      throw new Error(
        `${key} must be a nonempty value without surrounding whitespace`,
      );
    }
  }
  const wireFormat = env.THRUPUT_EXPECTED_WIRE_FORMAT ?? versions.wireFormat;
  if (!version.test(wireFormat))
    throw new Error("Expected wire format must be an exact version");
  return {
    devnodeBinary: env.THRUPUT_DEVNODE_BINARY ?? null,
    protocolOverride: env.HOGD_PROTOCOL_OVERRIDE ?? null,
    wireOverride: env.THRUPUT_EXPECTED_WIRE_FORMAT ?? null,
    wireFormat,
  };
}

/** Keep CI pins strict even when the setup action supplies an absolute path. */
export function qualifyIntegrationCli(versions, env, cliVersion) {
  integrationOverrides(versions, env);
  if (
    env.THRUPUT_CLI_SOURCE_COMMIT !== undefined &&
    (typeof env.THRUPUT_CLI_SOURCE_COMMIT !== "string" ||
      env.THRUPUT_CLI_SOURCE_COMMIT.length !== 40 ||
      !/^[0-9a-f]{40}$/.test(env.THRUPUT_CLI_SOURCE_COMMIT))
  ) {
    throw new Error(
      "CLI source identity must be a full lowercase Git commit SHA",
    );
  }
  if (env.THRUPUT_ALLOW_LOCAL_CANDIDATE === "1") {
    if (env.CI || env.GITHUB_ACTIONS) {
      throw new Error("Local candidate overrides are not allowed in CI");
    }
    if (!env.THRUPUT_CLI) {
      throw new Error("Local candidate qualification requires THRUPUT_CLI");
    }
    return {
      mode: "local-candidate",
      sourceCommit: env.THRUPUT_CLI_SOURCE_COMMIT ?? null,
    };
  }
  if (cliVersion !== versions.cli) {
    throw new Error(
      `Expected Thruput CLI ${versions.cli}, received ${cliVersion}`,
    );
  }
  const expected = versions.cliSourceCommit ?? null;
  if ((env.THRUPUT_CLI_SOURCE_COMMIT ?? null) !== expected) {
    throw new Error("CLI source identity does not match cliSourceCommit");
  }
  return {
    mode: expected === null ? "release" : "source",
    sourceCommit: expected,
  };
}

/** Verify serving build evidence, rather than trusting setup environment labels. */
export function qualifyServingCli(versions, env, cliVersion, observed) {
  const qualification = qualifyIntegrationCli(versions, env, cliVersion);
  const { wireFormat } = integrationOverrides(versions, env);
  if (
    observed === null ||
    typeof observed !== "object" ||
    Array.isArray(observed)
  ) {
    throw new Error("getVersionInfo must return an object");
  }
  if (observed.implementation !== cliVersion) {
    throw new Error(
      "Serving CLI implementation does not match the executable version",
    );
  }
  if (observed.wireFormat !== wireFormat) {
    throw new Error("Serving wire format does not match qualification pins");
  }
  if (
    observed.commitHash !== undefined &&
    (typeof observed.commitHash !== "string" ||
      observed.commitHash.length !== 40 ||
      !/^[0-9a-f]{40}$/.test(observed.commitHash))
  ) {
    throw new Error(
      "Serving commitHash must be a full lowercase Git commit SHA",
    );
  }
  if (
    qualification.sourceCommit !== null &&
    observed.commitHash !== qualification.sourceCommit
  ) {
    throw new Error("Serving CLI commitHash does not match the source pin");
  }
  return {
    implementation: observed.implementation,
    wireFormat: observed.wireFormat,
    commitHash: observed.commitHash ?? null,
  };
}

/** Require the response envelope for the single identity request. */
export function servingVersionResult(reply) {
  if (
    reply === null ||
    typeof reply !== "object" ||
    Array.isArray(reply) ||
    reply.jsonrpc !== "2.0" ||
    reply.id !== 1 ||
    "error" in reply ||
    !("result" in reply)
  ) {
    throw new Error("Invalid getVersionInfo RPC response");
  }
  return reply.result;
}

/** Read CLI startup reports across the current source-pin field rename. */
export function nodeStartupData(result) {
  if (result?.ok !== true || result.command !== "node" || !result.data) {
    throw new Error(`Node startup failed: ${JSON.stringify(result)}`);
  }
  const data = result.data;
  // The earlier pinned CLI uses snake_case; new reports use camelCase.
  const rpcUrl = Object.hasOwn(data, "rpcUrl") ? data.rpcUrl : data.rpc_url;
  const manifest = Object.hasOwn(data, "runtimeManifest")
    ? data.runtimeManifest
    : data.runtime_manifest;
  if (typeof rpcUrl !== "string")
    throw new Error("Node did not report an RPC URL");
  const url = new URL(rpcUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error(`Expected a local node URL, received ${url}`);
  }
  if (typeof manifest?.path !== "string" || !isAbsolute(manifest.path)) {
    throw new Error("Node did not report an absolute runtime manifest path");
  }
  return { rpcUrl, runtimeManifestPath: manifest.path };
}
