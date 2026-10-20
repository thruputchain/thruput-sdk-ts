import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

/** Keep CI pins strict even when the setup action supplies an absolute path. */
export function qualifyIntegrationCli(versions, env, cliVersion) {
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
