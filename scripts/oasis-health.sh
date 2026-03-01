#!/usr/bin/env bash
# oasis-health.sh — Comprehensive health check for the Oasis deployment.
#
# Checks Docker containers, API endpoints, launchd services, voice pipeline,
# disk usage, log health, and config sanity. Self-heals where possible.
#
# Usage:
#   scripts/oasis-health.sh          # Full check with self-healing
#   scripts/oasis-health.sh --check  # Read-only check (no auto-fix)
#
# Exit codes: 0 = all clear, 1 = warnings, 2 = critical issues found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}"
LOGS_DIR="$OPENCLAW_DIR/logs"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

# Parse flags
HEAL=true
if [[ "${1:-}" == "--check" ]]; then
  HEAL=false
fi

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# --- Counters ---
PASS=0
WARN=0
CRIT=0
HEALED=0

ok()   { ((PASS++)); echo -e "  ${GREEN}OK${RESET}    $1"; }
warn() { ((WARN++)); echo -e "  ${YELLOW}WARN${RESET}  $1"; }
crit() { ((CRIT++)); echo -e "  ${RED}CRIT${RESET}  $1"; }
heal() { ((HEALED++)); echo -e "  ${BLUE}HEAL${RESET}  $1"; }
section() { echo -e "\n${BOLD}[$1]${RESET}"; }

# ============================================================
# 1. Docker Containers
# ============================================================
section "Docker Containers"

cd "$PROJECT_DIR"

check_container() {
  local name="$1"
  local status
  status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
  local health
  health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo "unknown")

  if [[ "$status" == "running" ]]; then
    if [[ "$health" == "healthy" || "$health" == "none" ]]; then
      ok "$name — running${health:+ ($health)}"
    else
      crit "$name — running but $health"
      if $HEAL; then
        docker compose restart "$name" 2>/dev/null && heal "Restarted $name" || warn "Failed to restart $name"
      fi
    fi
  elif [[ "$status" == "missing" ]]; then
    warn "$name — not found (may not be started)"
  else
    crit "$name — status: $status"
    if $HEAL; then
      docker compose up -d "$name" 2>/dev/null && heal "Started $name" || warn "Failed to start $name"
    fi
  fi
}

# Map container names to compose service names for restart
check_container "oasis"
check_container "oasis-dashboard"
check_container "docker-proxy"
check_container "audio-listener"

# ============================================================
# 2. Gateway API
# ============================================================
section "Gateway API"

if node -e "require('net').createConnection(18789,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
  ok "Gateway TCP port 18789 responding"
else
  crit "Gateway TCP port 18789 unreachable"
fi

# ============================================================
# 3. Dashboard API
# ============================================================
section "Dashboard API"

if curl -sf --max-time 5 http://localhost:3000/api/health >/dev/null 2>&1; then
  ok "Dashboard health endpoint responding"
else
  crit "Dashboard health endpoint unreachable"
fi

# ============================================================
# 4. Launchd Services
# ============================================================
section "Launchd Services"

EXPECTED_SERVICES=(
  "com.openclaw.oasis"
  "com.openclaw.backup"
  "com.openclaw.weekly-update"
  "com.oasis.plaud-sync"
  "com.oasis.curator-manifest"
  "org.pulseaudio"
)

loaded_services=$(launchctl list 2>/dev/null | grep -iE "openclaw|oasis|pulseaudio" | awk '{print $3}' || true)

for svc in "${EXPECTED_SERVICES[@]}"; do
  if echo "$loaded_services" | grep -qx "$svc"; then
    # Check if PID column is "-" (not running) vs a number (running)
    pid=$(launchctl list 2>/dev/null | grep "$svc" | awk '{print $1}')
    if [[ "$pid" == "-" ]]; then
      ok "$svc — loaded (idle)"
    else
      ok "$svc — running (PID $pid)"
    fi
  else
    crit "$svc — not loaded"
    plist="$LAUNCH_AGENTS_DIR/${svc}.plist"
    if $HEAL && [[ -f "$plist" ]]; then
      launchctl load "$plist" 2>/dev/null && heal "Reloaded $svc" || warn "Failed to reload $svc"
    elif ! $HEAL; then
      : # check-only mode
    else
      warn "Plist not found: $plist"
    fi
  fi
done

# ============================================================
# 5. Transcription Pipeline (AssemblyAI via audio-listener)
# ============================================================
section "Transcription Pipeline"

# Transcription now uses AssemblyAI cloud API via audio-listener (port 9001)
if curl -sf --max-time 5 http://localhost:9001/health >/dev/null 2>&1; then
  ok "AssemblyAI transcription pipeline healthy (via audio-listener)"
else
  warn "Audio-listener API unreachable — transcription pipeline may be down"
fi

# ============================================================
# 6. Audio Listener
# ============================================================
section "Audio Listener"

if curl -sf --max-time 5 http://localhost:9001/health >/dev/null 2>&1; then
  ok "Audio listener health endpoint responding"
else
  warn "Audio listener unreachable (may be paused)"
fi

# ============================================================
# 7. PulseAudio Bridge
# ============================================================
section "PulseAudio Bridge"

if [[ -S /tmp/pulseaudio.socket ]]; then
  ok "PulseAudio socket exists at /tmp/pulseaudio.socket"
else
  crit "PulseAudio socket missing — audio listener cannot access microphone"
fi

PACTL="/usr/local/Cellar/pulseaudio/17.0/bin/pactl"
if "$PACTL" info >/dev/null 2>&1 || pactl info >/dev/null 2>&1; then
  ok "PulseAudio server responding"
else
  crit "PulseAudio not running"
  if $HEAL; then
    launchctl kickstart "gui/$(id -u)/org.pulseaudio" 2>/dev/null && heal "Restarted PulseAudio" || warn "Failed to restart PulseAudio"
  fi
fi

# ============================================================
# 8. Audio Pipeline
# ============================================================
section "Audio Pipeline"

inbox_dir="$HOME/oasis-audio/inbox"
done_dir="$HOME/oasis-audio/done"

if [[ -d "$inbox_dir" ]]; then
  inbox_count=$(find "$inbox_dir" -maxdepth 1 -name '*.wav' 2>/dev/null | wc -l | tr -d ' ')
  ok "Audio inbox: $inbox_count pending file(s)"
else
  warn "Audio inbox directory not found: $inbox_dir"
fi

if [[ -d "$done_dir" ]]; then
  done_count=$(find "$done_dir" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
  ok "Audio done: $done_count transcript(s)"
else
  warn "Audio done directory not found: $done_dir"
fi

# ============================================================
# 9. Disk Usage
# ============================================================
section "Disk Usage"

if [[ -d "$OPENCLAW_DIR" ]]; then
  total=$(du -sh "$OPENCLAW_DIR" 2>/dev/null | awk '{print $1}')
  ok "Total ~/.openclaw: $total"

  for subdir in logs workspace-curator/transcripts voice-profiles voice-transcripts; do
    dir="$OPENCLAW_DIR/$subdir"
    if [[ -d "$dir" ]]; then
      size=$(du -sh "$dir" 2>/dev/null | awk '{print $1}')
      echo -e "  ${DIM}     $subdir: $size${RESET}"
    fi
  done
fi

# ============================================================
# 10. Log Health
# ============================================================
section "Log Health"

if [[ -d "$LOGS_DIR" ]]; then
  found_errors=false
  for logfile in "$LOGS_DIR"/*.log; do
    [[ -f "$logfile" ]] || continue
    name=$(basename "$logfile")
    errs=$(tail -100 "$logfile" | grep -ci "error\|fatal\|exception\|traceback" || true)
    if (( errs > 0 )); then
      warn "$name — $errs error(s) in last 100 lines"
      found_errors=true
    fi
  done
  if ! $found_errors; then
    ok "No errors in recent log entries"
  fi
else
  warn "Logs directory not found: $LOGS_DIR"
fi

# ============================================================
# 11. Config Sanity
# ============================================================
section "Config Sanity"

env_file="$PROJECT_DIR/.env"
config_file="$OPENCLAW_DIR/openclaw.json"

if [[ -f "$env_file" && -s "$env_file" ]]; then
  line_count=$(wc -l < "$env_file" | tr -d ' ')
  ok ".env exists ($line_count lines)"
else
  crit ".env missing or empty"
fi

if [[ -f "$config_file" ]]; then
  if python3 -c "import json; json.load(open('$config_file'))" 2>/dev/null; then
    ok "openclaw.json is valid JSON"
  else
    warn "openclaw.json may have JSON5 syntax (not parseable by Python json module)"
  fi
else
  crit "openclaw.json not found: $config_file"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${BOLD}─── Summary ───${RESET}"
echo -e "  ${GREEN}Pass: $PASS${RESET}  ${YELLOW}Warn: $WARN${RESET}  ${RED}Crit: $CRIT${RESET}  ${BLUE}Healed: $HEALED${RESET}"

if (( CRIT > 0 )); then
  echo -e "\n${RED}${BOLD}Critical issues detected.${RESET}"
  exit 2
elif (( WARN > 0 )); then
  echo -e "\n${YELLOW}Warnings found — review above.${RESET}"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}All systems operational.${RESET}"
  exit 0
fi
