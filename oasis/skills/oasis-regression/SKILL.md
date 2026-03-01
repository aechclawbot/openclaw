---
name: oasis-regression
description: Run comprehensive regression tests across the entire OASIS stack. Tests unit tests (Vitest), Docker container health, gateway API, all dashboard API endpoints, audio pipeline, launchd services, and cron job execution history. Use when asked to run tests, verify the system works, run regression, check everything is working, or validate after changes.
metadata: { "openclaw": { "emoji": "🧪", "requires": { "bins": ["pnpm", "docker"] } } }
---

# OASIS Full Regression Testing

Systematically test every subsystem and produce a pass/fail report.

## Test Execution Order

### 1. Unit Tests (Vitest)

```bash
cd /Users/oasis/openclaw && pnpm test
```

If memory pressure is a concern:

```bash
OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test
```

Record: total tests, passed, failed, skipped, duration.

### 2. Docker Container Health

Run the existing health script in check-only mode:

```bash
/Users/oasis/openclaw/scripts/oasis-health.sh --check
```

This checks all 4 containers, gateway port, dashboard endpoint, launchd services, audio pipeline, PulseAudio, disk usage, log health, and config sanity. Exit code: 0=ok, 1=warn, 2=crit.

### 3. Gateway API Tests

```bash
nc -z -w 3 localhost 18789
curl -sf --max-time 5 http://localhost:18789/health
```

### 4. Dashboard API Tests

Run `skills/oasis-regression/scripts/test-dashboard-apis.sh` or test manually:

```bash
AUTH="oasis:ReadyPlayer@1"
BASE="http://localhost:3000"
```

Test each endpoint group:

- Health: `GET /api/health`, `GET /api/system`
- Agents: `GET /api/agents`
- Chat: `GET /api/chat/sessions`
- Cron: `GET /api/cron`
- Docker: `GET /api/docker/containers`
- Todos: `GET /api/todos`
- Voice: `GET /api/voice/transcripts`, `GET /api/voice/profiles`, `GET /api/voice/stats`, `GET /api/voice/pipeline`
- Curator: `GET /api/curator/stats`, `GET /api/curator/search?q=test`
- Treasury: `GET /api/treasury/summary`, `GET /api/treasury/v2`
- Recipes: `GET /api/recipes`
- Settings: `GET /api/settings`, `GET /api/models`, `GET /api/bindings`, `GET /api/channels`
- Activity: `GET /api/activity`
- Metrics: `GET /api/metrics/summary`, `GET /api/metrics/agents`, `GET /api/metrics/cron`, `GET /api/metrics/system`
- Features: `GET /api/features`
- Preferences: `GET /api/preferences`
- Audit: `GET /api/audit/qa/reports`, `GET /api/audit/security/reports`
- Usage: `GET /api/usage`
- Sessions: `GET /api/sessions`
- Spawn: `GET /api/spawn/templates`
- Dito: `GET /api/dito/pipeline`, `GET /api/dito/leads`, `GET /api/dito/demos`
- Nolan: `GET /api/nolan/projects`
- Aech: `GET /api/aech/deals`
- Logs: `GET /api/logs/gateway?tail=10`, `GET /api/logs/audio-listener?tail=10`

For each: record HTTP status code, response time, whether body parses as JSON.

### 5. Audio Pipeline Tests

```bash
# Audio listener health
curl -sf --max-time 5 http://localhost:9001/health

# PulseAudio socket
test -S /tmp/pulseaudio.socket && echo "OK" || echo "MISSING"

# Queue depth
ls ~/oasis-audio/inbox/*.wav 2>/dev/null | wc -l
ls ~/oasis-audio/done/*.json 2>/dev/null | wc -l
```

### 6. Launchd Service Status

Verify expected services are loaded:

```bash
launchctl list | grep -E "com\.(openclaw|oasis)|org\.pulseaudio|ai\.openclaw"
```

Expected (12):
`com.openclaw.oasis`, `com.openclaw.backup`, `com.openclaw.weekly-update`, `com.openclaw.bug-scanner`, `com.oasis.plaud-sync`, `com.oasis.curator-manifest`, `com.oasis.health-alert`, `com.oasis.nightly-import`, `com.oasis.transcript-sync`, `org.pulseaudio`, `ai.openclaw.audio-import`, `ai.openclaw.voice-listener`

### 7. Cron Job Verification

```bash
for f in ~/.openclaw/cron/runs/*.jsonl; do
  name=$(basename "$f" .jsonl)
  last=$(tail -1 "$f" 2>/dev/null | jq -r '.timestamp // .ts // empty' 2>/dev/null)
  echo "$name: last=$last"
done
```

### 8. Report

```
## OASIS Regression Report — [date]

| Subsystem | Status | Details |
|-----------|--------|---------|
| Unit Tests | PASS/FAIL | X/Y passed, Z failed |
| Health Check | PASS/WARN/CRIT | exit code + summary |
| Gateway API | PASS/FAIL | port + health endpoint |
| Dashboard API | PASS/FAIL | X/Y endpoints ok |
| Audio Pipeline | PASS/FAIL/DEGRADED | listener + sync + pulse |
| Launchd Services | PASS/WARN | X/Y loaded |
| Cron Jobs | PASS/WARN | X/Y recently executed |

### Failed Items
[details of failures]
```
