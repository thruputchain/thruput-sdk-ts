#!/usr/bin/env bash
set -euo pipefail

GENERATOR="${GROUNDHOG_OPENRPC_GENERATOR:-}"
if [[ -z "$GENERATOR" ]]; then
  cargo install groundhog-open-rpc-spec@0.21.0 --registry groundhog 2>/dev/null
  GENERATOR="groundhog-open-rpc-spec"
fi
SPEC="$(git rev-parse --show-toplevel)/specs/openrpc.json"
GENERATED="$(mktemp)"
trap 'rm -f "$GENERATED"' EXIT
"$GENERATOR" > "$GENERATED"
node --input-type=module - "$GENERATED" <<'NODE'
import { readFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (spec.info.version !== "8.2.0") {
  throw new Error("Select the reviewed GH-462 generator with GROUNDHOG_OPENRPC_GENERATOR; this snapshot requires wire 8.2.0. The published pinned generator predates local funding.");
}
NODE
cp "$GENERATED" "$SPEC"
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$SPEC" >/dev/null
echo "Regenerated specs/openrpc.json"
echo "Next: run \`npm test\` — any TS action whose serialized request no longer matches the new spec will fail, and the failure names the method and the offending fields."
