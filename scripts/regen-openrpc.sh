#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

groundhog-open-rpc-spec > "$REPO_ROOT/specs/openrpc.json"
echo "Regenerated specs/openrpc.json"
