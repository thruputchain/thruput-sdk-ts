#!/usr/bin/env node
// Loads every subpath in the package `exports` map under the current Node
// runtime, in both ESM and CJS form.
//
// `npm test` runs src/ through vitest's transform pipeline, so it can pass on
// a runtime that cannot actually load the artifact we publish — a downlevel
// syntax gap, a builtin that is missing on an older major, a broken exports
// entry. This loads the real dist/ files, which is what the CI version matrix
// needs to exercise for the matrix to mean anything.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

const failures = [];
let checked = 0;

for (const [subpath, entry] of Object.entries(pkg.exports)) {
  for (const condition of ["import", "require"]) {
    const relative = entry[condition];
    if (!relative) continue;

    const target = fileURLToPath(new URL(relative, root));
    checked++;
    try {
      const mod =
        condition === "import" ? await import(target) : require(target);
      const names = Object.keys(mod).filter(
        (k) => k !== "default" && k !== "__esModule",
      );
      if (names.length === 0) {
        failures.push(`${subpath} (${condition}): loaded but exported nothing`);
      }
    } catch (err) {
      failures.push(`${subpath} (${condition}): ${err.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Smoke test FAILED on Node ${process.version} (${pkg.name}@${pkg.version}):`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nRun `npm run build` first if dist/ is stale.");
  process.exit(1);
}

console.log(
  `Smoke test passed on Node ${process.version}: ${checked} entry points loaded from dist/.`,
);
