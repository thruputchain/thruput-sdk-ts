#!/usr/bin/env bash
set -euo pipefail

cargo install groundhog-open-rpc-spec@0.3.0 --registry groundhog 2>/dev/null
groundhog-open-rpc-spec > "$(git rev-parse --show-toplevel)/specs/openrpc.json"
echo "Regenerated specs/openrpc.json"
