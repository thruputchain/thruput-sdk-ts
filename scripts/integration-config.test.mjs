import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateIntegrationVersions,
  qualifyIntegrationCli,
  integrationOverrides,
  qualifyServingCli,
  servingVersionResult,
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

test("serving identity must prove the configured source independently of setup labels", () => {
  const sha = "a".repeat(40);
  const pins = { ...released, cliSourceCommit: sha };
  const env = { THRUPUT_CLI_SOURCE_COMMIT: sha, CI: "true" };
  const observed = {
    implementation: "0.33.0",
    wireFormat: "14.0.0",
    commitHash: sha,
  };
  assert.deepEqual(qualifyServingCli(pins, env, "0.33.0", observed), observed);
  for (const commitHash of [undefined, "b".repeat(40)]) {
    assert.throws(
      () => qualifyServingCli(pins, env, "0.33.0", { ...observed, commitHash }),
      /source pin/,
    );
  }
  for (const commitHash of [null, 42, "abc", "A".repeat(40), sha + "\n"]) {
    assert.throws(
      () => qualifyServingCli(pins, env, "0.33.0", { ...observed, commitHash }),
      /full lowercase/,
    );
  }
  for (const value of [null, [], "14.0.0", undefined]) {
    assert.throws(
      () => qualifyServingCli(pins, env, "0.33.0", value),
      /object/,
    );
  }
  for (const implementation of [undefined, "0.32.0", null, 33]) {
    assert.throws(
      () =>
        qualifyServingCli(pins, env, "0.33.0", { ...observed, implementation }),
      /implementation/,
    );
  }
  for (const wireFormat of [undefined, "13.0.0", null, 14]) {
    assert.throws(
      () => qualifyServingCli(pins, env, "0.33.0", { ...observed, wireFormat }),
      /wire format/,
    );
  }
});

test("release identity retains an available commit without inventing a source pin", () => {
  const observed = { implementation: "0.33.0", wireFormat: "14.0.0" };
  assert.deepEqual(qualifyServingCli(released, {}, "0.33.0", observed), {
    ...observed,
    commitHash: null,
  });
  const withCommit = { ...observed, commitHash: "b".repeat(40) };
  assert.deepEqual(
    qualifyServingCli(released, {}, "0.33.0", withCommit),
    withCommit,
  );
});

test("qualification overrides require explicit local mode and are rejected in CI", () => {
  const overrides = {
    THRUPUT_DEVNODE_BINARY: "/tmp/hog-devnode",
    HOGD_PROTOCOL_OVERRIDE: "candidate-protocol",
    THRUPUT_EXPECTED_WIRE_FORMAT: "14.1.0",
  };
  for (const [key, value] of Object.entries(overrides)) {
    assert.throws(
      () => qualifyIntegrationCli(released, { [key]: value }, "0.33.0"),
      /explicit local candidate/,
    );
    for (const ci of ["CI", "GITHUB_ACTIONS"]) {
      assert.throws(
        () =>
          qualifyIntegrationCli(
            released,
            { [ci]: "true", [key]: value },
            "0.33.0",
          ),
        /not allowed in CI/,
      );
    }
  }
  const env = {
    ...overrides,
    THRUPUT_ALLOW_LOCAL_CANDIDATE: "1",
    THRUPUT_CLI: "/tmp/thruput",
  };
  assert.deepEqual(integrationOverrides(released, env), {
    devnodeBinary: "/tmp/hog-devnode",
    protocolOverride: "candidate-protocol",
    wireOverride: "14.1.0",
    wireFormat: "14.1.0",
  });
  assert.deepEqual(
    qualifyServingCli(released, env, "0.34.0", {
      implementation: "0.34.0",
      wireFormat: "14.1.0",
      commitHash: "c".repeat(40),
    }),
    {
      implementation: "0.34.0",
      wireFormat: "14.1.0",
      commitHash: "c".repeat(40),
    },
  );
  for (const key of Object.keys(overrides)) {
    for (const value of ["", " value "]) {
      assert.throws(
        () => integrationOverrides(released, { ...env, [key]: value }),
        /nonempty/,
      );
    }
  }
  assert.throws(
    () =>
      integrationOverrides(released, {
        ...env,
        THRUPUT_EXPECTED_WIRE_FORMAT: "14",
      }),
    /exact version/,
  );
});

test("identity lookup rejects invalid RPC envelopes", () => {
  const result = { implementation: "0.33.0", wireFormat: "14.0.0" };
  const reply = { jsonrpc: "2.0", id: 1, result };
  assert.equal(servingVersionResult(reply), result);
  for (const value of [
    null,
    [],
    "reply",
    undefined,
    {},
    { ...reply, jsonrpc: "1.0" },
    { ...reply, id: "1" },
    { ...reply, error: null },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "missing" } },
  ]) {
    assert.throws(() => servingVersionResult(value), /RPC response/);
  }
});

test("local source claims are validated early and checked against the serving build", () => {
  const sha = "d".repeat(40);
  const env = {
    THRUPUT_ALLOW_LOCAL_CANDIDATE: "1",
    THRUPUT_CLI: "/tmp/thruput",
    THRUPUT_CLI_SOURCE_COMMIT: sha,
  };
  const result = {
    implementation: "0.34.0",
    wireFormat: "14.0.0",
    commitHash: sha,
  };
  assert.deepEqual(qualifyServingCli(released, env, "0.34.0", result), result);
  assert.throws(
    () =>
      qualifyServingCli(released, env, "0.34.0", {
        ...result,
        commitHash: "e".repeat(40),
      }),
    /source pin/,
  );
  for (const bad of ["main", "abc", sha + "\n", "A".repeat(40)]) {
    assert.throws(
      () =>
        qualifyIntegrationCli(
          released,
          { ...env, THRUPUT_CLI_SOURCE_COMMIT: bad },
          "0.34.0",
        ),
      /full lowercase/,
    );
  }
});
