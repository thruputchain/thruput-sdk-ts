#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
groundhog_cli="${GROUNDHOG_CLI:?Set GROUNDHOG_CLI to the reviewed groundhog executable}"
erc20_spec="${ERC20_CONTRACT_SPEC:-$repo_root/specs/contracts/erc20.spec.xdr}"
recursive_type_spec="${RECURSIVE_TYPE_CONTRACT_SPEC:-$repo_root/specs/contracts/recursive_type.spec.xdr}"
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
  local generated="$tmp_dir/$(basename "$output")"

  "$groundhog_cli" codegen ts "$spec" -o "$generated"
  node --input-type=module - "$generated" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2];
const source = readFileSync(path, "utf8");
const moduleSpecifier = '"@groundhogchain/client/contract"';
const matches = source.split(moduleSpecifier).length - 1;

if (matches !== 1) {
  throw new Error(
    `Expected exactly one ${moduleSpecifier} import in ${path}, found ${matches}`,
  );
}

writeFileSync(path, source.replace(moduleSpecifier, '"../contract/index.js"'));
NODE
  npx prettier --write "$generated" >/dev/null

  if [[ "$mode" == "--check" ]]; then
    if ! cmp -s "$generated" "$output"; then
      printf '%s is not up to date; run scripts/regenerate-contract-bindings.sh\n' "$output" >&2
      return 1
    fi
  else
    cp "$generated" "$output"
  fi
}

generate "$erc20_spec" "$repo_root/src/contracts/erc20.ts"
generate "$recursive_type_spec" "$repo_root/src/contracts/recursive_type.ts"
