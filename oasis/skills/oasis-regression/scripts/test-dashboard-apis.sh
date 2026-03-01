#!/usr/bin/env bash
# test-dashboard-apis.sh — Test all OASIS Dashboard API endpoints
# Usage: ./test-dashboard-apis.sh [base_url]
# Returns: JSON summary of test results

set -euo pipefail

BASE="${1:-http://localhost:3000}"
AUTH="oasis:ReadyPlayer@1"
PASS=0
FAIL=0
TOTAL=0
RESULTS=""

test_endpoint() {
  local method="$1"
  local path="$2"
  local desc="$3"
  TOTAL=$((TOTAL + 1))

  local status
  local time
  status=$(curl -sf -u "$AUTH" -o /dev/null -w "%{http_code}" --max-time 10 -X "$method" "$BASE$path" 2>/dev/null || echo "000")
  time=$(curl -sf -u "$AUTH" -o /dev/null -w "%{time_total}" --max-time 10 -X "$method" "$BASE$path" 2>/dev/null || echo "0")

  if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
    PASS=$((PASS + 1))
    RESULTS="${RESULTS}  PASS | ${status} | ${time}s | ${method} ${path} | ${desc}\n"
  else
    FAIL=$((FAIL + 1))
    RESULTS="${RESULTS}  FAIL | ${status} | ${time}s | ${method} ${path} | ${desc}\n"
  fi
}

echo "Testing OASIS Dashboard APIs at $BASE"
echo "======================================="
echo ""

# Health & System
test_endpoint GET "/api/health" "Health check"
test_endpoint GET "/api/system" "System info"

# Agents
test_endpoint GET "/api/agents" "List agents"

# Chat
test_endpoint GET "/api/chat/sessions" "Chat sessions"

# Cron
test_endpoint GET "/api/cron" "Cron jobs"

# Docker
test_endpoint GET "/api/docker/containers" "Docker containers"

# Todos
test_endpoint GET "/api/todos" "Todo list"

# Voice
test_endpoint GET "/api/voice/transcripts" "Voice transcripts"
test_endpoint GET "/api/voice/profiles" "Voice profiles"
test_endpoint GET "/api/voice/stats" "Voice stats"
test_endpoint GET "/api/voice/pipeline" "Voice pipeline"

# Curator
test_endpoint GET "/api/curator/stats" "Curator stats"
test_endpoint GET "/api/curator/search?q=test" "Curator search"

# Treasury
test_endpoint GET "/api/treasury/summary" "Treasury summary"

# Recipes
test_endpoint GET "/api/recipes" "Recipes index"

# Settings
test_endpoint GET "/api/settings" "Settings"
test_endpoint GET "/api/models" "Models"
test_endpoint GET "/api/bindings" "Bindings"
test_endpoint GET "/api/channels" "Channels"

# Activity & Metrics
test_endpoint GET "/api/activity" "Activity log"
test_endpoint GET "/api/metrics/summary" "Metrics summary"
test_endpoint GET "/api/metrics/agents" "Agent metrics"
test_endpoint GET "/api/metrics/cron" "Cron metrics"
test_endpoint GET "/api/metrics/system" "System metrics"

# Features & Preferences
test_endpoint GET "/api/features" "Features"
test_endpoint GET "/api/preferences" "Preferences"

# Audit
test_endpoint GET "/api/audit/qa/reports" "QA reports"
test_endpoint GET "/api/audit/security/reports" "Security reports"

# Usage & Sessions
test_endpoint GET "/api/usage" "Usage data"
test_endpoint GET "/api/sessions" "Sessions"

# Spawn
test_endpoint GET "/api/spawn/templates" "Spawn templates"

# Business
test_endpoint GET "/api/dito/pipeline" "Dito pipeline"
test_endpoint GET "/api/dito/leads" "Dito leads"
test_endpoint GET "/api/dito/demos" "Dito demos"
test_endpoint GET "/api/nolan/projects" "Nolan projects"
test_endpoint GET "/api/aech/deals" "Aech deals"

# Logs
test_endpoint GET "/api/logs/gateway?tail=5" "Gateway logs"
test_endpoint GET "/api/logs/audio-listener?tail=5" "Audio listener logs"

echo ""
echo "Results:"
echo "--------"
printf "$RESULTS"
echo ""
echo "======================================="
echo "Total: $TOTAL | Passed: $PASS | Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
