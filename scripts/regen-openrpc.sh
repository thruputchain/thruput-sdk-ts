#!/usr/bin/env bash
set -euo pipefail

GENERATOR="${GROUNDHOG_OPENRPC_GENERATOR:-}"
if [[ -z "$GENERATOR" ]]; then
  cargo install groundhog-open-rpc-spec@0.10.0 --registry groundhog 2>/dev/null
  GENERATOR="groundhog-open-rpc-spec"
fi
SPEC="$(git rev-parse --show-toplevel)/specs/openrpc.json"
"$GENERATOR" > "$SPEC"
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$SPEC" >/dev/null
echo "Regenerated specs/openrpc.json"
echo "Next: run \`npm test\` — any TS action whose serialized request no longer matches the new spec will fail, and the failure names the method and the offending fields."
