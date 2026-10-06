#!/usr/bin/env bash
set -euo pipefail

GENERATOR="${GROUNDHOG_OPENRPC_GENERATOR:-}"
if [[ -z "$GENERATOR" ]]; then
  cargo install groundhog-open-rpc-spec@0.23.0 --registry groundhog
  GENERATOR="groundhog-open-rpc-spec"
fi
SPEC="$(git rev-parse --show-toplevel)/specs/openrpc.json"
TEMP_SPEC="$(mktemp)"
trap 'rm -f "$TEMP_SPEC"' EXIT
"$GENERATOR" > "$TEMP_SPEC"
# Reject a stale published generator before it can overwrite the local-funding spec.
node --input-type=module - "$TEMP_SPEC" <<'JS'
import { readFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (spec.info.version !== "9.1.0") {
  throw new Error(`Expected RPC wire 9.1.0, received ${spec.info.version}. Set GROUNDHOG_OPENRPC_GENERATOR to a matching generator.`);
}
JS
cp "$TEMP_SPEC" "$SPEC"
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$SPEC" >/dev/null
echo "Regenerated specs/openrpc.json"
echo "Next: run \`npm test\` — any TS action whose serialized request no longer matches the new spec will fail, and the failure names the method and the offending fields."
