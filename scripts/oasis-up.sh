#!/usr/bin/env bash
# oasis-up.sh — Start OpenClaw containers.
#
# Usage:
#   scripts/oasis-up.sh            # docker compose up -d
#   scripts/oasis-up.sh down       # docker compose down
#   scripts/oasis-up.sh logs -f    # docker compose logs -f
#   scripts/oasis-up.sh restart    # docker compose restart
#
# All secrets are stored in .env alongside non-secret config and passed
# to containers via env_file in docker-compose.yml.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default to "up -d" if no args given
if [[ $# -eq 0 ]]; then
  set -- up -d
fi

cd "$PROJECT_DIR"
echo "Running: docker compose $*"
exec docker compose "$@"
