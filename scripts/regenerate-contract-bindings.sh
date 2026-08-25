#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
groundhog_cli="${GROUNDHOG_CLI:?Set GROUNDHOG_CLI to the reviewed groundhog executable}"
mode="${1:-write}"

if [[ "$mode" != "write" && "$mode" != "--check" ]]; then
  printf 'Usage: %s [--check]\n' "$0" >&2
  exit 2
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

generate() {
  local spec="$1"
  local output="$2"
  local import_path="$3"
  local generated="$tmp_dir/$(basename "$output")"

  "$groundhog_cli" codegen ts "$spec" -o "$generated"
  node --input-type=module - "$generated" "$import_path" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2];
const importPath = process.argv[3];
const source = readFileSync(path, "utf8");
const moduleSpecifier = '"@groundhogchain/client/contract"';
const matches = source.split(moduleSpecifier).length - 1;

if (matches !== 1) {
  throw new Error(
    `Expected exactly one ${moduleSpecifier} import in ${path}, found ${matches}`,
  );
}

writeFileSync(path, source.replace(moduleSpecifier, JSON.stringify(importPath)));
NODE
  npx prettier --write "$generated" >/dev/null
}

update() {
  local output="$1"
  local generated="$tmp_dir/$(basename "$output")"
  if [[ "$mode" == "--check" ]]; then
    if ! cmp -s "$generated" "$output"; then
      printf '%s is not up to date; run npm run contracts:generate\n' "$output" >&2
      return 1
    fi
  else
    cp "$generated" "$output"
  fi
}

erc20_output="$repo_root/src/contracts/erc20.ts"
recursive_type_output="$repo_root/src/contracts/recursive_type.ts"
default_wallet_output="$repo_root/src/contracts/default_wallet.ts"
dev_wallet_output="$repo_root/src/contracts/dev_wallet.ts"
counter_output="$repo_root/examples/generated/counter.ts"

generate "$repo_root/specs/contracts/erc20.spec.xdr" "$erc20_output" "../contract/index.js"
generate "$repo_root/specs/contracts/recursive_type.spec.xdr" "$recursive_type_output" "../contract/index.js"
generate "$repo_root/specs/contracts/default_wallet.spec.xdr" "$default_wallet_output" "../contract/index.js"
generate "$repo_root/specs/contracts/dev_wallet.spec.xdr" "$dev_wallet_output" "../contract/index.js"
generate "$repo_root/specs/contracts/counter.spec.xdr" "$counter_output" "../../src/contract/index.js"

update "$erc20_output"
update "$recursive_type_output"
update "$default_wallet_output"
update "$dev_wallet_output"
update "$counter_output"
