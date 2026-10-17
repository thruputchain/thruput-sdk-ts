#!/usr/bin/env bash
set -euo pipefail

GENERATOR="${THRUPUT_OPENRPC_GENERATOR:-}"
if [[ -z "$GENERATOR" ]]; then
  cargo install thruput-open-rpc-spec@0.31.0 --registry thruput --locked
  GENERATOR="thruput-open-rpc-spec"
fi
SPEC="$(git rev-parse --show-toplevel)/specs/openrpc.json"
TEMP_SPEC="$(mktemp)"
trap 'rm -f "$TEMP_SPEC"' EXIT
"$GENERATOR" > "$TEMP_SPEC"
# Reject a stale generator before it can overwrite the pinned wire contract.
node --input-type=module - "$TEMP_SPEC" <<'JS'
import { readFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (spec.info.version !== "12.1.0") {
  throw new Error(`Expected RPC wire 12.1.0, received ${spec.info.version}. Set THRUPUT_OPENRPC_GENERATOR to a matching generator.`);
}
for (const name of ["groundhog_fundAccount", "groundhog_viewBatch", "groundhog_getTransactionsByBlock"]) {
  if (!spec.methods.some((method) => method.name === name)) {
    throw new Error(`Generator is missing ${name}. Set THRUPUT_OPENRPC_GENERATOR to a matching generator.`);
  }
}
const limit = spec.components.schemas.BlockTransactionQuery?.properties?.limit;
if (limit?.minimum !== 1 || limit?.maximum !== 200) {
  throw new Error("Generator does not enforce the reviewed positive block-page limit contract.");
}
JS
cp "$TEMP_SPEC" "$SPEC"
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$SPEC" >/dev/null
echo "Regenerated specs/openrpc.json"
echo "Next: run \`npm test\` — any TS action whose serialized request no longer matches the new spec will fail, and the failure names the method and the offending fields."
