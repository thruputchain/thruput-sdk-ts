import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import versions from "./integration-versions.json" with { type: "json" };
import { harnessTimeoutMs, runnerTimeoutMs } from "./integration-timeouts.mjs";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
const blocks = process.argv.includes("--blocks");
const abort = new AbortController();
const children = [];
let work;
let logs;

function onSignal(signal) {
  abort.abort(new Error(`Integration run interrupted by ${signal}`));
}
const onInterrupt = () => onSignal("SIGINT");
const onTerminate = () => onSignal("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

// A separate session lets cleanup find the backend even though hog-devnode
// creates its own process group beneath the CLI supervisor.
function launch(command, args, env, label, inheritOutput = false) {
  const output = [];
  let child;
  try {
    if (!inheritOutput) {
      output.push(openSync(join(logs, `${label}.stdout.log`), "w"));
      output.push(openSync(join(logs, `${label}.stderr.log`), "w"));
    }
    child = spawn(command, args, {
      cwd: work,
      env,
      detached: true,
      stdio: inheritOutput
        ? ["ignore", "inherit", "inherit"]
        : ["ignore", ...output],
    });
  } finally {
    output.forEach(closeSync);
  }
  const task = { child, label, result: undefined, done: undefined };
  task.done = new Promise((resolveDone) => {
    child.once("error", (error) => {
      task.result = { error };
      resolveDone(task.result);
    });
    child.once("exit", (code, signal) => {
      task.result = { code, signal };
      resolveDone(task.result);
    });
  });
  children.push(task);
  return task;
}

function requireSuccess(task, result) {
  if (result.error) throw result.error;
  if (result.code !== 0) {
    throw new Error(
      `${task.label} exited with ${result.signal ?? result.code}`,
    );
  }
}

async function bounded(promise, timeoutMs, label, signal = abort.signal) {
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      sleep(timeoutMs, undefined, {
        signal: signal ? AbortSignal.any([signal, timer.signal]) : timer.signal,
      }).then(() => {
        throw new Error(`${label} timed out after ${timeoutMs}ms`);
      }),
    ]);
  } finally {
    timer.abort();
  }
}

async function startup(task) {
  const path = join(logs, "node.stdout.log");
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    abort.signal.throwIfAborted();
    if (task.result) {
      requireSuccess(task, task.result);
      throw new Error("Node exited before reporting readiness");
    }
    const text = await readFile(path, "utf8");
    const end = text.indexOf("\n");
    if (end !== -1) {
      const result = JSON.parse(text.slice(0, end));
      if (!result.ok || result.command !== "node") {
        throw new Error(`Node startup failed: ${JSON.stringify(result)}`);
      }
      const url = new URL(result.data.rpc_url);
      if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        !url.port
      ) {
        throw new Error(`Expected a local node URL, received ${url}`);
      }
      if (!isAbsolute(result.data.runtime_manifest.path)) {
        throw new Error(
          "Node did not report an absolute runtime manifest path",
        );
      }
      return result.data;
    }
    await sleep(100, undefined, { signal: abort.signal });
  }
  throw new Error("Node did not report readiness within 60 seconds");
}

async function sessionProcesses(session) {
  if (!session) return [];
  const { stdout } = await exec("ps", ["-eo", "pid=,sid=,stat="], {
    timeout: 5_000,
  });
  return stdout
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [pid, sid, state] = line.trim().split(/\s+/);
      return Number(sid) === session && !state.startsWith("Z")
        ? [Number(pid)]
        : [];
    });
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop(task) {
  if (!task.child.pid) return;
  if (!task.result) {
    task.child.kill("SIGTERM");
    await bounded(task.done, 15_000, `${task.label} shutdown`, null).catch(
      () => {},
    );
  }
  let survivors = await sessionProcesses(task.child.pid);
  if (survivors.length === 0) {
    requireSuccess(task, await task.done);
    return;
  }
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    survivors.forEach((pid) => signalProcess(pid, signal));
    const deadline = performance.now() + 5_000;
    do {
      await sleep(100);
      survivors = await sessionProcesses(task.child.pid);
    } while (survivors.length && performance.now() < deadline);
    if (!survivors.length) break;
  }
  throw new Error(
    `${task.label} did not shut down cleanly; remaining processes: ${survivors.join(", ") || "none after forced cleanup"}`,
  );
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error("The live-node harness currently supports Linux only");
  }
  const requestedCli = process.env.THRUPUT_CLI ?? "thruput";
  const cli = requestedCli.includes("/") ? resolve(requestedCli) : requestedCli;
  const { stdout } = await exec(cli, ["--version"], { timeout: 10_000 });
  const cliVersion = /^thruput (\d+\.\d+\.\d+(?:-[^\s]+)?)(?:\s|$)/.exec(
    stdout,
  )?.[1];
  if (
    !cliVersion ||
    (!process.env.THRUPUT_CLI && cliVersion !== versions.cli)
  ) {
    throw new Error(
      `Expected Thruput CLI ${versions.cli}, received ${stdout.trim()}`,
    );
  }

  work = await mkdtemp(join(tmpdir(), "thruput-client-integration-"));
  logs = resolve(process.env.THRUPUT_INTEGRATION_LOG_DIR ?? join(work, "logs"));
  await mkdir(logs, { recursive: true });
  console.log(`Integration logs: ${logs}`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("GROUNDHOG_") ||
      key.startsWith("THRUPUT_") ||
      key === "HOGD_PROTOCOL_OVERRIDE"
    )
      delete env[key];
  }
  env.XDG_CONFIG_HOME = join(work, "config");
  env.XDG_CACHE_HOME = join(work, "cache");
  env.XDG_DATA_HOME = join(work, "data");

  let devnodeBinary = process.env.THRUPUT_DEVNODE_BINARY;
  if (devnodeBinary !== undefined && !isAbsolute(devnodeBinary)) {
    throw new Error("THRUPUT_DEVNODE_BINARY must be an absolute path");
  }
  if (devnodeBinary === undefined) {
    const install = launch(
      cli,
      ["--json", "toolchain", "install", versions.devnode],
      env,
      "install",
    );
    requireSuccess(
      install,
      await bounded(install.done, 300_000, "Devnode installation"),
    );
    const installed = JSON.parse(
      await readFile(join(logs, "install.stdout.log"), "utf8"),
    );
    if (
      !installed.ok ||
      typeof installed.data?.path !== "string" ||
      !isAbsolute(installed.data.path)
    ) {
      throw new Error("Devnode installation did not report an executable path");
    }
    devnodeBinary = installed.data.path;
  }
  // Run directly so dynamic-loader failures reach our logs rather than being
  // reduced to an exit code by the node supervisor.
  const preflight = launch(
    devnodeBinary,
    ["--version"],
    env,
    "devnode-version",
  );
  requireSuccess(
    preflight,
    await bounded(preflight.done, 10_000, "Devnode version preflight"),
  );
  const node = launch(
    cli,
    [
      "--json",
      "node",
      "--startup-timeout-secs",
      "45",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      ...(process.env.THRUPUT_DEVNODE_BINARY
        ? ["--hog-devnode-binary", devnodeBinary]
        : ["--hog-devnode-version", versions.devnode]),
      ...(process.env.HOGD_PROTOCOL_OVERRIDE
        ? ["--hogd-protocol", process.env.HOGD_PROTOCOL_OVERRIDE]
        : []),
      "--offline",
      "--block-driver",
      blocks ? "interval" : "instant",
      ...(blocks
        ? ["--block-interval-ms", "2000", "--ramdb-bytes", "128M"]
        : []),
      "--data-dir",
      join(work, "node"),
    ],
    env,
    "node",
  );
  const ready = await startup(node);
  console.log(
    `Testing CLI ${cliVersion} / devnode ${devnodeBinary} at ${ready.rpc_url}`,
  );
  const tests = launch(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      `--test-timeout=${runnerTimeoutMs}`,
      ...(blocks
        ? [join(repo, "tests/integration/block-queries.test.mjs")]
        : [
            join(repo, "tests/integration/live-node.test.mjs"),
            join(repo, "tests/integration/local-funding.test.mjs"),
          ]),
    ],
    {
      ...env,
      THRUPUT_RPC_URL: ready.rpc_url,
      THRUPUT_RUNTIME_MANIFEST: ready.runtime_manifest.path,
      THRUPUT_EXPECTED_CLI_VERSION: cliVersion,
      THRUPUT_EXPECTED_WIRE_FORMAT:
        process.env.THRUPUT_EXPECTED_WIRE_FORMAT ?? versions.wireFormat,
    },
    "tests",
    true,
  );
  const result = await bounded(
    Promise.race([
      tests.done,
      node.done.then(() => {
        throw new Error("Node exited while integration tests were running");
      }),
    ]),
    harnessTimeoutMs,
    "Integration tests",
  );
  requireSuccess(tests, result);
  abort.signal.throwIfAborted();
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const task of children.toReversed()) {
    try {
      await stop(task);
    } catch (error) {
      failed = true;
      console.error(error);
    }
  }
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  failed ||= abort.signal.aborted;
  if (failed) {
    if (logs) {
      for (const label of ["install", "devnode-version", "node"]) {
        const stderr = await readFile(
          join(logs, `${label}.stderr.log`),
          "utf8",
        ).catch(() => "");
        if (stderr)
          console.error(
            `${label} stderr (last 8 KiB):\n${stderr.slice(-8192)}`,
          );
      }
    }
    console.error(
      `Integration failed. Logs and node state retained at ${work ?? "(startup failed)"}${logs ? `; logs: ${logs}` : ""}`,
    );
    process.exitCode = 1;
  } else if (work) {
    await rm(work, { recursive: true, force: true });
  }
}
