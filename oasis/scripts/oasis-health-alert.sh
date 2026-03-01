#!/usr/bin/env bash
# oasis-health-alert.sh — Lightweight health monitor with Telegram alerting.
# Checks gateway and dashboard health, alerts Fred if anything is down.
# Designed to run every 10 minutes via launchd.
#
# Uses TELEGRAM_BOT_TOKEN and MASTER_TELEGRAM_USER_ID from .env

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_FILE="${HOME}/.openclaw/health-alert-state.json"

# Load .env for Telegram token
if [[ -f "$PROJECT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${MASTER_TELEGRAM_USER_ID:-7955595068}"

send_telegram() {
  local msg="$1"
  if [[ -z "$TELEGRAM_TOKEN" ]]; then
    echo "No TELEGRAM_BOT_TOKEN set, skipping alert"
    return 1
  fi
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" \
    -d text="$msg" \
    -d parse_mode="Markdown" >/dev/null 2>&1
}

# Track state to avoid repeated alerts
read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE"
  else
    echo '{}'
  fi
}

write_state() {
  echo "$1" > "$STATE_FILE"
}

ISSUES=()
RECOVERIES=()
PREV_STATE=$(read_state)

# --- Check 1: Gateway port ---
if nc -z -w 3 localhost 18789 2>/dev/null; then
  if echo "$PREV_STATE" | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('gateway_down') else 1)" 2>/dev/null; then
    RECOVERIES+=("Gateway recovered (port 18789 responding)")
  fi
  GATEWAY_OK=true
else
  ISSUES+=("Gateway DOWN — port 18789 not responding")
  GATEWAY_OK=false
fi

# --- Check 2: Dashboard health endpoint ---
DASH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:3000/api/health" 2>/dev/null || echo "000")
if [[ "$DASH_STATUS" == "200" ]]; then
  if echo "$PREV_STATE" | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('dashboard_down') else 1)" 2>/dev/null; then
    RECOVERIES+=("Dashboard recovered (HTTP 200)")
  fi
  DASHBOARD_OK=true
else
  ISSUES+=("Dashboard DOWN — /api/health returned HTTP $DASH_STATUS")
  DASHBOARD_OK=false
fi

# --- Check 3: Container health ---
for container in oasis oasis-dashboard audio-listener; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
  HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo "unknown")

  if [[ "$STATUS" != "running" ]]; then
    ISSUES+=("Container \`$container\` is $STATUS (not running)")
  elif [[ "$HEALTH" == "unhealthy" ]]; then
    ISSUES+=("Container \`$container\` is unhealthy")
  fi
done

# --- Check 4: Disk space ---
DISK_PCT=$(df -h /Users/oasis | tail -1 | awk '{print $5}' | tr -d '%')
if [[ "$DISK_PCT" -gt 90 ]]; then
  ISSUES+=("Disk usage at ${DISK_PCT}% — running low")
fi

# --- Build state ---
GW_DOWN=$( [ "$GATEWAY_OK" = true ] && echo "False" || echo "True" )
DASH_DOWN=$( [ "$DASHBOARD_OK" = true ] && echo "False" || echo "True" )
NEW_STATE=$(python3 -c "
import json
print(json.dumps({
    'gateway_down': $GW_DOWN,
    'dashboard_down': $DASH_DOWN,
    'last_check': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'issue_count': ${#ISSUES[@]}
}))
")
write_state "$NEW_STATE"

# --- Send alerts ---
if [[ ${#ISSUES[@]} -gt 0 ]]; then
  MSG="🔴 *OASIS Health Alert*"$'\n'
  for issue in "${ISSUES[@]}"; do
    MSG+="• $issue"$'\n'
  done
  MSG+=$'\n'"_$(date '+%H:%M ET')_"
  send_telegram "$MSG"
  echo "ALERT: ${#ISSUES[@]} issues found, notified Fred"
fi

if [[ ${#RECOVERIES[@]} -gt 0 ]]; then
  MSG="🟢 *OASIS Recovery*"$'\n'
  for rec in "${RECOVERIES[@]}"; do
    MSG+="• $rec"$'\n'
  done
  MSG+=$'\n'"_$(date '+%H:%M ET')_"
  send_telegram "$MSG"
  echo "RECOVERY: ${#RECOVERIES[@]} services recovered, notified Fred"
fi

if [[ ${#ISSUES[@]} -eq 0 && ${#RECOVERIES[@]} -eq 0 ]]; then
  echo "All clear — $(date '+%H:%M ET')"
fi

exit 0
