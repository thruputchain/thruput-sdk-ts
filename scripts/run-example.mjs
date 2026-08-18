import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [name, ...args] = process.argv.slice(2);

if (!name) {
  console.error(
    "Usage: npm run example <name> [-- <args>]\nExample: npm run example deploy-counter",
  );
  process.exit(1);
}

const examplesDirectory = fileURLToPath(
  new URL("../examples/", import.meta.url),
);
const requestedPath = name.endsWith(".ts") ? name : `${name}.ts`;
const examplePath = name.startsWith("examples/")
  ? path.resolve(requestedPath)
  : path.resolve(examplesDirectory, requestedPath);

if (!existsSync(examplePath)) {
  console.error(`Example not found: ${examplePath}`);
  process.exit(1);
}

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const result = spawnSync(process.execPath, [tsxCli, examplePath, ...args], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
