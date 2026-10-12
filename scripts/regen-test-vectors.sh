#!/usr/bin/env bash
set -euo pipefail

cargo install thruput-test-vectors@0.51.0 --registry thruput --locked
VECTORS_DIR="$(git rev-parse --show-toplevel)/specs/test-vectors"
mkdir -p "$VECTORS_DIR"
thruput-test-vectors domain-separator > "$VECTORS_DIR/domain-separator.json"
thruput-test-vectors entrypoint-id > "$VECTORS_DIR/entrypoint-id.json"
thruput-test-vectors signed-op > "$VECTORS_DIR/signed-op.json"
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$VECTORS_DIR"/*.json >/dev/null
echo "Regenerated specs/test-vectors/"
echo "Next: run \`npm test\` — the derivation and signed-op tests replay every vector, so a mismatch names the vector and the stage (prefix, preimage CXS, address, or signed message) that drifted."
