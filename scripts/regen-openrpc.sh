#!/usr/bin/env bash
set -euo pipefail

cargo install groundhog-open-rpc-spec@0.3.1 --registry groundhog 2>/dev/null
SPEC="$(git rev-parse --show-toplevel)/specs/openrpc.json"
groundhog-open-rpc-spec > "$SPEC"
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$SPEC" >/dev/null
echo "Regenerated specs/openrpc.json"
