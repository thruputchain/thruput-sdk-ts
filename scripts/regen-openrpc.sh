#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/regen-native-openrpc.sh" "$@"
