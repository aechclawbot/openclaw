#!/usr/bin/env bash
# keychain-store.sh — One-time import of all OpenClaw secrets into macOS Keychain.
# Usage: ./scripts/keychain-store.sh
#
# Reads current .env and .secrets/*.env values and stores each secret
# in the macOS Keychain under service "openclaw". Idempotent (-U flag
# updates an existing entry).
#
# After running this, secrets can be removed from .env and the manual
# .secrets files. oasis-up.sh will read them from Keychain at launch.

set -euo pipefail

SERVICE="openclaw"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}/.secrets"

# Secrets to import: name|source_file pairs (bash 3.2 compatible)
SECRETS="
OPENCLAW_GATEWAY_TOKEN|dashboard.env
ANTHROPIC_API_KEY|.env
GEMINI_API_KEY|dashboard.env
OPENAI_API_KEY|.env
BRAVE_SEARCH_API_KEY|.env
TELEGRAM_BOT_TOKEN|.env
CLAUDE_CODE_TELEGRAM_BOT_TOKEN|.env
TELNYX_API_KEY|.env
TELNYX_PUBLIC_KEY|.env
NGROK_AUTHTOKEN|.env
CLAWLANCER_API_KEY|.env
NOLAN_ETH_PRIVATE_KEY|eth-keys.env
OASIS_ETH_PRIVATE_KEY|eth-keys.env
AECH_ETH_PRIVATE_KEY|eth-keys.env
OPENCLAW_DASHBOARD_USERNAME|dashboard.env
OPENCLAW_DASHBOARD_PASSWORD|dashboard.env
HF_TOKEN|.env
"

# Read a value from a KEY=VALUE file
read_value() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2- || true
}

imported=0
skipped=0
failed=0

echo "Importing OpenClaw secrets into macOS Keychain (service: ${SERVICE})"
echo "-------------------------------------------------------------------"

# Process each secret (bash 3.2 compatible)
while IFS='|' read -r name source_file; do
  # Skip empty lines
  [[ -z "$name" ]] && continue

  # Resolve file path
  if [[ "$source_file" == ".env" ]]; then
    file_path="${PROJECT_DIR}/.env"
  else
    file_path="${SECRETS_DIR}/${source_file}"
  fi

  if [[ ! -f "$file_path" ]]; then
    echo "  SKIP  ${name} — source file not found: ${file_path}"
    ((skipped++))
    continue
  fi

  value=$(read_value "$file_path" "$name")

  if [[ -z "$value" ]]; then
    echo "  SKIP  ${name} — empty or not found in ${source_file}"
    ((skipped++))
    continue
  fi

  if security add-generic-password -U -s "$SERVICE" -a "$name" -w "$value"; then
    echo "  OK    ${name}"
    ((imported++))
  else
    echo "  FAIL  ${name} — keychain write failed (auth required)"
    ((failed++))
  fi
done <<< "$SECRETS"

echo "-------------------------------------------------------------------"
echo "Done: ${imported} imported, ${skipped} skipped, ${failed} failed"

if ((failed > 0)); then
  exit 1
fi
