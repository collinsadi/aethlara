#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Kill any existing air process in this directory.
pkill -f "air.*build.cmd.*go build.*aethlara-server" 2>/dev/null && sleep 0.5 || true

# Export all variables from .env, then start air.
set -a
source .env
set +a

exec air --build.cmd "go build -o tmp/main ./cmd/api" --build.bin "tmp/main"