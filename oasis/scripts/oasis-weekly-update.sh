#!/usr/bin/env bash
# oasis-weekly-update.sh — Pull latest OpenClaw from upstream, rebuild, and QA.
#
# Usage:
#   scripts/oasis-weekly-update.sh          # Full update + rebuild + QA
#   scripts/oasis-weekly-update.sh --dry-run # Check for updates without applying
#
# Sends a Telegram notification on completion (or failure).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$HOME/.openclaw/logs"
LOG_FILE="$LOG_DIR/weekly-update-$(date +%Y%m%d-%H%M%S).log"
HEALTH_SCRIPT="$SCRIPT_DIR/oasis-health.sh"
TELEGRAM_CHAT_ID="7955595068"

mkdir -p "$LOG_DIR"

# Redirect all output to log file AND stdout
exec > >(tee -a "$LOG_FILE") 2>&1

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# --- Helpers ---
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }
log()  { echo "[$(timestamp)] $1"; }
fail() { echo "[$(timestamp)] FAIL: $1"; send_telegram "❌ OASIS Weekly Update FAILED: $1"; exit 1; }

send_telegram() {
  local msg="$1"
  # Source .env for the gateway token
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    local token
    token=$(grep '^OPENCLAW_GATEWAY_TOKEN=' "$PROJECT_DIR/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [[ -n "$token" ]]; then
      curl -sf --max-time 10 \
        -X POST "http://localhost:18789/api/v1/message" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"channel\":\"telegram\",\"to\":\"$TELEGRAM_CHAT_ID\",\"text\":\"$msg\"}" \
        >/dev/null 2>&1 || true
    fi
  fi
}

# --- Pre-flight ---
log "=== OASIS Weekly Update Started ==="
log "Project: $PROJECT_DIR"
cd "$PROJECT_DIR"

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running"
fi

# Ensure upstream remote exists
if ! git remote | grep -q '^upstream$'; then
  log "Adding upstream remote..."
  git remote add upstream https://github.com/openclaw/openclaw.git
fi

# --- Fetch upstream ---
log "Fetching upstream/main..."
git fetch upstream main 2>&1 || fail "git fetch upstream failed"

# Count commits behind
BEHIND=$(git rev-list --count HEAD..upstream/main 2>/dev/null || echo "0")
CURRENT_SHA=$(git rev-parse --short HEAD)
UPSTREAM_SHA=$(git rev-parse --short upstream/main)

log "Current: $CURRENT_SHA | Upstream: $UPSTREAM_SHA | Behind: $BEHIND commits"

if [[ "$BEHIND" == "0" ]]; then
  log "Already up to date — no update needed."
  send_telegram "✅ OASIS Weekly Update: Already up to date ($CURRENT_SHA)"
  exit 0
fi

if $DRY_RUN; then
  log "DRY RUN: Would merge $BEHIND commits from upstream/main"
  log "Latest upstream commits:"
  git log --oneline HEAD..upstream/main | head -10
  exit 0
fi

# --- Pause low-priority containers to free resources ---
log "Pausing low-priority containers for build headroom..."
docker pause transcriber diarizer audio-listener 2>/dev/null || true

# --- Merge upstream ---
log "Merging upstream/main ($BEHIND commits)..."
if ! git merge upstream/main --no-edit 2>&1; then
  # Check for conflicts
  CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
  if [[ -n "$CONFLICTS" ]]; then
    log "MERGE CONFLICTS detected in:"
    echo "$CONFLICTS"
    git merge --abort 2>/dev/null || true
    docker unpause transcriber diarizer audio-listener 2>/dev/null || true
    fail "Merge conflicts — manual resolution required. Files: $(echo "$CONFLICTS" | tr '\n' ', ')"
  fi
  docker unpause transcriber diarizer audio-listener 2>/dev/null || true
  fail "git merge failed for unknown reason"
fi

NEW_SHA=$(git rev-parse --short HEAD)
log "Merge complete: $CURRENT_SHA → $NEW_SHA ($BEHIND commits merged)"

# --- Install dependencies ---
log "Installing dependencies (pnpm install)..."
pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1 || fail "pnpm install failed"

# --- Build ---
log "Building project (pnpm build)..."
if ! pnpm build 2>&1; then
  log "Build failed — attempting to continue with existing dist..."
  BUILD_STATUS="FAILED"
else
  BUILD_STATUS="OK"
fi

# --- Rebuild Docker image ---
log "Rebuilding Docker image..."
OPENCLAW_IMAGE="${OPENCLAW_IMAGE:-openclaw:local}"

# Build base image from source
if ! docker build -t openclaw:local . 2>&1; then
  docker unpause transcriber diarizer audio-listener 2>/dev/null || true
  fail "Docker base image build failed"
fi

# Build OASIS layer
if ! docker build -t "$OPENCLAW_IMAGE" -f Dockerfile.oasis --build-arg BASE_IMAGE=openclaw:local . 2>&1; then
  docker unpause transcriber diarizer audio-listener 2>/dev/null || true
  fail "Docker OASIS image build failed"
fi
log "Docker image rebuilt successfully"

# --- Restart containers ---
log "Restarting OpenClaw containers..."
docker compose up -d --force-recreate 2>&1 || fail "docker compose up failed"

# Wait for gateway to become healthy
log "Waiting for gateway to become healthy..."
WAIT_SECS=0
MAX_WAIT=120
while [[ $WAIT_SECS -lt $MAX_WAIT ]]; do
  if docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{end}}' oasis 2>/dev/null | grep -q "healthy"; then
    break
  fi
  sleep 5
  WAIT_SECS=$((WAIT_SECS + 5))
done

if [[ $WAIT_SECS -ge $MAX_WAIT ]]; then
  log "WARNING: Gateway did not become healthy within ${MAX_WAIT}s"
  GW_HEALTH="TIMEOUT"
else
  log "Gateway healthy after ${WAIT_SECS}s"
  GW_HEALTH="OK"
fi

# --- QA: Run health checks ---
log "Running QA health checks..."
QA_STATUS="OK"
if [[ -x "$HEALTH_SCRIPT" ]]; then
  if ! "$HEALTH_SCRIPT" --check 2>&1; then
    QA_STATUS="WARNINGS"
    log "Health check reported warnings (see above)"
  fi
else
  log "Health script not found at $HEALTH_SCRIPT — skipping"
  QA_STATUS="SKIPPED"
fi

# --- QA: Check gateway API ---
log "Testing gateway API..."
if curl -sf --max-time 10 http://localhost:18789/health >/dev/null 2>&1; then
  log "Gateway API: OK"
  API_STATUS="OK"
else
  log "Gateway API: UNREACHABLE"
  API_STATUS="FAIL"
fi

# --- QA: Check dashboard ---
log "Testing dashboard..."
if curl -sf --max-time 10 http://localhost:3000/api/health >/dev/null 2>&1; then
  log "Dashboard: OK"
  DASH_STATUS="OK"
else
  log "Dashboard: UNREACHABLE"
  DASH_STATUS="FAIL"
fi

# --- QA: Check container states ---
log "Checking container states..."
CONTAINER_ISSUES=""
for container in oasis oasis-dashboard docker-proxy transcriber diarizer audio-listener; do
  status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
  if [[ "$status" != "running" ]]; then
    CONTAINER_ISSUES="$CONTAINER_ISSUES $container($status)"
  fi
done

if [[ -n "$CONTAINER_ISSUES" ]]; then
  log "Container issues:$CONTAINER_ISSUES"
fi

# --- Summary ---
log ""
log "=== Update Summary ==="
log "  Commits merged: $BEHIND"
log "  SHA: $CURRENT_SHA → $NEW_SHA"
log "  Build: $BUILD_STATUS"
log "  Gateway health: $GW_HEALTH"
log "  Gateway API: $API_STATUS"
log "  Dashboard: $DASH_STATUS"
log "  Health QA: $QA_STATUS"
log "  Container issues:${CONTAINER_ISSUES:- none}"
log "  Log: $LOG_FILE"
log "=== Update Complete ==="

# Build notification message
EMOJI="✅"
if [[ "$API_STATUS" == "FAIL" || "$GW_HEALTH" == "TIMEOUT" || "$BUILD_STATUS" == "FAILED" ]]; then
  EMOJI="⚠️"
fi

MSG="$EMOJI OASIS Weekly Update Complete
Merged: $BEHIND commits ($CURRENT_SHA → $NEW_SHA)
Build: $BUILD_STATUS | Gateway: $GW_HEALTH
API: $API_STATUS | Dashboard: $DASH_STATUS | QA: $QA_STATUS"

if [[ -n "$CONTAINER_ISSUES" ]]; then
  MSG="$MSG
Issues:$CONTAINER_ISSUES"
fi

send_telegram "$MSG"

# Clean up old update logs (keep last 12)
ls -t "$LOG_DIR"/weekly-update-*.log 2>/dev/null | tail -n +13 | xargs rm -f 2>/dev/null || true

log "Done."
