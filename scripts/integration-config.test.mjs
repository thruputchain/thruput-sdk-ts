import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateIntegrationVersions,
  qualifyIntegrationCli,
} from "./integration-config.mjs";

const released = {
  cli: "0.33.0",
  devnode: "0.1.31-rc.11",
  wireFormat: "14.0.0",
};

test("accepts exact released versions and an optional immutable source commit", () => {
  assert.deepEqual(validateIntegrationVersions(released), released);
  const source = { ...released, cliSourceCommit: "a".repeat(40) };
  assert.deepEqual(validateIntegrationVersions(source), source);
});

test("rejects moving refs, malformed SHAs and output injection", () => {
  for (const cliSourceCommit of [
    "main",
    "v0.33.0",
    "abcdef",
    "A".repeat(40),
    "a".repeat(41),
    null,
    123,
    "a".repeat(40) + "\ncli=1.0.0",
  ]) {
    assert.throws(
      () => validateIntegrationVersions({ ...released, cliSourceCommit }),
      /full lowercase/,
    );
  }
});

test("rejects missing, non-exact and unknown pins", () => {
  for (const key of ["cli", "devnode", "wireFormat"]) {
    for (const value of [
      undefined,
      "latest",
      "^0.33.0",
      "0.33",
      "0.33.0\n",
      14,
    ]) {
      assert.throws(
        () => validateIntegrationVersions({ ...released, [key]: value }),
        /exact version/,
      );
    }
  }
  assert.throws(
    () => validateIntegrationVersions({ ...released, cliSourceRef: "main" }),
    /Unknown/,
  );
  for (const value of [null, [], "0.33.0"])
    assert.throws(() => validateIntegrationVersions(value), /object/);
});

test("an absolute CLI path does not bypass the released version pin", () => {
  const env = { THRUPUT_CLI: "/tmp/bin/thruput", CI: "true" };
  assert.deepEqual(qualifyIntegrationCli(released, env, "0.33.0"), {
    mode: "release",
    sourceCommit: null,
  });
  assert.throws(
    () => qualifyIntegrationCli(released, env, "0.32.0"),
    /Expected Thruput CLI/,
  );
  assert.throws(
    () =>
      qualifyIntegrationCli(
        released,
        { ...env, THRUPUT_CLI_SOURCE_COMMIT: "a".repeat(40) },
        "0.33.0",
      ),
    /source identity/,
  );
});

test("source qualification requires the configured version and exact SHA", () => {
  const sha = "a".repeat(40);
  const source = { ...released, cliSourceCommit: sha };
  const env = {
    THRUPUT_CLI: "/tmp/bin/thruput",
    THRUPUT_CLI_SOURCE_COMMIT: sha,
  };
  assert.deepEqual(qualifyIntegrationCli(source, env, "0.33.0"), {
    mode: "source",
    sourceCommit: sha,
  });
  assert.throws(
    () => qualifyIntegrationCli(source, env, "0.32.0"),
    /Expected Thruput CLI/,
  );
  for (const value of [undefined, "b".repeat(40), "main"]) {
    assert.throws(
      () =>
        qualifyIntegrationCli(
          source,
          { ...env, THRUPUT_CLI_SOURCE_COMMIT: value },
          "0.33.0",
        ),
      /source identity/,
    );
  }
});

test("local candidate opt-in is explicit, recorded and unavailable in CI", () => {
  const env = {
    THRUPUT_ALLOW_LOCAL_CANDIDATE: "1",
    THRUPUT_CLI: "/tmp/bin/thruput",
  };
  assert.deepEqual(qualifyIntegrationCli(released, env, "0.32.2"), {
    mode: "local-candidate",
    sourceCommit: null,
  });
  assert.throws(
    () =>
      qualifyIntegrationCli(
        released,
        { THRUPUT_ALLOW_LOCAL_CANDIDATE: "1" },
        "0.32.2",
      ),
    /requires THRUPUT_CLI/,
  );
  for (const key of ["CI", "GITHUB_ACTIONS"]) {
    assert.throws(
      () =>
        qualifyIntegrationCli(released, { ...env, [key]: "true" }, "0.32.2"),
      /not allowed in CI/,
    );
  }
});
