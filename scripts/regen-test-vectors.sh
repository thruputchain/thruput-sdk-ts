#!/usr/bin/env bash
set -euo pipefail

cargo install groundhog-test-vectors@0.17.3 --registry groundhog 2>/dev/null
VECTORS_DIR="$(git rev-parse --show-toplevel)/specs/test-vectors"
mkdir -p "$VECTORS_DIR"
groundhog-test-vectors domain-separator > "$VECTORS_DIR/domain-separator.json"
groundhog-test-vectors entrypoint-id > "$VECTORS_DIR/entrypoint-id.json"
# `signed-op` landed after the pinned version above. Until the pin is bumped to
# a release carrying it, warn and carry on rather than aborting the whole regen
# under `set -e`; the cross-SDK test skips itself when the file is absent.
groundhog-test-vectors signed-op > "$VECTORS_DIR/signed-op.json" || {
  rm -f "$VECTORS_DIR/signed-op.json"
  echo "warning: this groundhog-test-vectors build has no 'signed-op' subcommand; bump the pin above once a release carries it" >&2
}
# Run prettier so the committed snapshot matches the rest of the repo's
# formatting and `npm run format:check` stays clean across regens.
npx --no-install prettier --write "$VECTORS_DIR"/*.json >/dev/null
echo "Regenerated specs/test-vectors/"
echo "Next: run \`npm test\` — the derivation tests replay every vector, so a mismatch names the vector and the stage (prefix, preimage CXS, or address) that drifted."
