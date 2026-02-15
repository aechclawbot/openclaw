#!/usr/bin/env bash
# oasis-up.sh — Start OpenClaw containers with secrets from macOS Keychain.
#
# Usage:
#   scripts/oasis-up.sh            # docker compose up -d
#   scripts/oasis-up.sh down       # docker compose down
#   scripts/oasis-up.sh logs -f    # docker compose logs -f
#   scripts/oasis-up.sh restart    # regenerate secrets + restart
#
# Secrets are read from Keychain at launch and written to ephemeral
# .secrets/*.env files (mode 600). These are bind-mounted into containers
# and sourced by docker-secrets-entrypoint.sh.

set -euo pipefail

SERVICE="openclaw"
SECRETS_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}/.secrets"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Commands that need secrets generated before running
NEEDS_SECRETS=("up" "restart" "start" "")

# Check if the first arg (compose subcommand) needs secrets
compose_cmd="${1:-up}"
needs_secrets=false
for cmd in "${NEEDS_SECRETS[@]}"; do
  if [[ "$compose_cmd" == "$cmd" ]]; then
    needs_secrets=true
    break
  fi
done

# --- Read a secret from Keychain ---
kc_read() {
  local name="$1"
  local value
  value=$(security find-generic-password -s "$SERVICE" -a "$name" -w 2>/dev/null) || {
    echo "ERROR: Secret '${name}' not found in Keychain (service: ${SERVICE})" >&2
    echo "       Run scripts/keychain-store.sh first to import secrets." >&2
    return 1
  }
  echo "$value"
}

# --- Generate secrets files ---
generate_secrets() {
  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"

  echo "Reading secrets from Keychain..."

  # Gateway secrets
  local gateway_file="${SECRETS_DIR}/gateway.env"
  local gateway_keys=(
    OPENCLAW_GATEWAY_TOKEN
    ANTHROPIC_API_KEY
    GEMINI_API_KEY
    OPENAI_API_KEY
    BRAVE_SEARCH_API_KEY
    TELEGRAM_BOT_TOKEN
    TELNYX_API_KEY
    TELNYX_PUBLIC_KEY
    NGROK_AUTHTOKEN
    CLAWLANCER_API_KEY
    NOLAN_ETH_PRIVATE_KEY
    OASIS_ETH_PRIVATE_KEY
    AECH_ETH_PRIVATE_KEY
  )

  : > "$gateway_file"
  chmod 600 "$gateway_file"
  for key in "${gateway_keys[@]}"; do
    local val
    val=$(kc_read "$key") || exit 1
    echo "${key}=${val}" >> "$gateway_file"
  done
  echo "  Written: gateway.env (${#gateway_keys[@]} secrets)"

  # Dashboard secrets (gateway token + Gemini key shared)
  local dashboard_file="${SECRETS_DIR}/dashboard.env"
  local dashboard_keys=(
    OPENCLAW_GATEWAY_TOKEN
    GEMINI_API_KEY
    OPENCLAW_DASHBOARD_USERNAME
    OPENCLAW_DASHBOARD_PASSWORD
  )

  : > "$dashboard_file"
  chmod 600 "$dashboard_file"
  for key in "${dashboard_keys[@]}"; do
    local val
    val=$(kc_read "$key") || exit 1
    echo "${key}=${val}" >> "$dashboard_file"
  done
  echo "  Written: dashboard.env (${#dashboard_keys[@]} secrets)"
}

# --- Main ---
if $needs_secrets; then
  generate_secrets
fi

# Default to "up -d" if no args given
if [[ $# -eq 0 ]]; then
  set -- up -d
fi

cd "$PROJECT_DIR"
echo "Running: docker compose $*"
exec docker compose "$@"
