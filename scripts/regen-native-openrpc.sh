#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
TEMP_SPEC="$(mktemp)"
trap 'rm -f "$TEMP_SPEC"' EXIT
# Until a native generator is published, select the Rust-generated native-spec.json
# from a reviewed tools checkout. Record the exact source commit, not a release guess.
: "${THRUPUT_NATIVE_OPENRPC_COMMIT:?Set the full reviewed thruput-tools commit}"
if [[ -n "${THRUPUT_NATIVE_OPENRPC_SOURCE:-}" ]]; then
  cp "$THRUPUT_NATIVE_OPENRPC_SOURCE" "$TEMP_SPEC"
elif [[ -n "${THRUPUT_OPENRPC_GENERATOR:-}" ]]; then
  "$THRUPUT_OPENRPC_GENERATOR" > "$TEMP_SPEC"
else
  echo 'Set THRUPUT_NATIVE_OPENRPC_SOURCE to the Rust-generated native-spec.json or THRUPUT_OPENRPC_GENERATOR to a reviewed native generator.' >&2
  exit 1
fi
node --input-type=module - "$TEMP_SPEC" <<'JS'
import { readFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.argv[2],"utf8"));
if (spec.info.version !== "14.0.0" || spec.methods.length !== 20 || spec.methods.some(m=>m.paramStructure !== "by-name" || m.name.startsWith("groundhog_"))) throw new Error("Expected the complete native wire-14 catalog");
for (const name of ["getTransactionsByRootAddress","getTransactionsByBlock","getEvents"]) {
 const method = spec.methods.find(m=>m.name===name);
 if (method?.params.find(p=>p.name==="limit")?.schema.minimum !== 1) throw new Error(`Missing positive pagination limit: ${name}`);
}
JS
cp "$TEMP_SPEC" "$ROOT/specs/native-openrpc.json"
node --input-type=module - "$ROOT" "$THRUPUT_NATIVE_OPENRPC_COMMIT" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [root, commit] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Expected full reviewed tools commit");
const { nativeSpecDigest } = await import(pathToFileURL(`${root}/scripts/native-spec-digest.mjs`));
const sha256 = nativeSpecDigest(JSON.parse(readFileSync(`${root}/specs/native-openrpc.json`, "utf8")));
writeFileSync(`${root}/specs/native-openrpc.provenance.json`, JSON.stringify({ repository: "https://github.com/thruputchain/thruput-tools", commit, sha256 }, null, 2) + "\n");
JS
node "$ROOT/scripts/generate-native-rpc.mjs"
npx --no-install prettier --write "$ROOT/specs/native-openrpc.json" "$ROOT/src/rpc/generated.ts" "$ROOT/src/rpc/schema.json" >/dev/null
