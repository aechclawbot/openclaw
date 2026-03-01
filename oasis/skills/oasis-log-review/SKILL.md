---
name: oasis-log-review
description: Parse and analyze all OASIS log sources for errors, warnings, and anomalies. Covers host logs (~/.openclaw/logs/), Docker container logs, agent session logs, cron run logs, /tmp/ transient logs, and macOS unified logs. Produces a severity-ranked findings report. Use when asked to check logs, review errors, diagnose issues, find problems, review system health, or investigate failures.
metadata: { "openclaw": { "emoji": "📋" } }
---

# OASIS Log Review

Systematically parse all log sources and produce a prioritized findings report.

## Log Sources (check in order)

### 1. Host Logs (`~/.openclaw/logs/`)

Check each file (tail last 200 lines, search for errors):

| File                       | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `health-alert.log`         | Container & gateway health (10m interval) |
| `transcript-sync.log`      | WhisperX to curator sync                  |
| `cron.log`                 | Bug-scanner output                        |
| `nightly-import.log`       | Audio import pipeline                     |
| `launchd-oasis.log`        | Gateway startup                           |
| `commands.log`             | CLI command history                       |
| `config-audit.jsonl`       | Config change audit trail                 |
| `pulseaudio.log`           | PulseAudio service                        |
| `pulseaudio-error.log`     | PulseAudio errors                         |
| `audio-import.log`         | Audio import stdout                       |
| `audio-import-error.log`   | Audio import stderr                       |
| `voice-listener.log`       | Voice listener stdout                     |
| `voice-listener-error.log` | Voice listener stderr                     |

For each:

```bash
# Count errors in last 200 lines
tail -200 "$file" | grep -ciE "error|fatal|exception|traceback|panic|fail"
# Extract error lines with context
tail -200 "$file" | grep -B2 -A2 -iE "error|fatal|exception|traceback|panic|fail"
# Check file age (stale logs may indicate dead services)
stat -f '%Sm' "$file"
```

### 2. Docker Container Logs

```bash
for container in oasis oasis-dashboard audio-listener docker-proxy; do
  echo "=== $container ==="
  docker logs --since 1h "$container" 2>&1 | grep -ciE "error|fatal|exception|traceback"
  docker logs --since 1h "$container" 2>&1 | grep -iE "error|fatal|exception|traceback" | tail -10
done
```

### 3. Agent Session Logs

Check the most recent session for each active agent:

```bash
for agent in oasis oasis-social anorak nolan dito aech ir0k curator ogden art3mis; do
  latest=$(ls -t ~/.openclaw/agents/$agent/sessions/*.jsonl 2>/dev/null | head -1)
  if [[ -n "$latest" ]]; then
    jq -r 'select(.message.role == "toolResult") | select(.message.content[]?.text // "" | test("error|fail|exception"; "i")) | .timestamp' "$latest" 2>/dev/null | tail -5
  fi
done
```

### 4. Cron Run Logs

```bash
for f in ~/.openclaw/cron/runs/*.jsonl; do
  name=$(basename "$f" .jsonl)
  jq -r 'select(.status == "failed" or .error != null) | "\(.timestamp) FAILED: \(.error // "unknown")"' "$f" 2>/dev/null | tail -3
done
```

### 5. Transient Logs (`/tmp/`)

```bash
tail -50 /tmp/plaud-sync.log 2>/dev/null | grep -iE "error|fail"
tail -50 /tmp/plaud-sync-error.log 2>/dev/null | head -10
tail -50 /tmp/openclaw-backup.log 2>/dev/null | grep -iE "error|fail"
```

### 6. Health Alert State

```bash
cat ~/.openclaw/health-alert-state.json 2>/dev/null
```

Check if `gateway_down` or `dashboard_down` is true. Check `last_check` timestamp.

### 7. macOS Unified Logs (optional, if other sources insufficient)

```bash
/Users/oasis/openclaw/scripts/clawlog.sh -c gateway --last 1h 2>/dev/null | grep -iE "error|fail" | tail -20
```

## Severity Classification

| Severity | Criteria                                                                    |
| -------- | --------------------------------------------------------------------------- |
| CRITICAL | Service down, data loss risk, repeated crashes, health alert active         |
| HIGH     | Errors causing functional degradation, failed cron jobs, container restarts |
| MEDIUM   | Intermittent errors, stale logs (service may be dead), warnings             |
| LOW      | Minor warnings, deprecated usage, info-level noise                          |

## Report Format

```
## OASIS Log Review — [date]

### Critical Issues
- [source] [timestamp] [description]

### High Severity
- [source] [timestamp] [description]

### Medium Severity
- [source] [timestamp] [description]

### Low Severity / Noise
- [source] [timestamp] [description]

### Summary
- Total issues: X (C critical, H high, M medium, L low)
- Log sources checked: Y/Z
- Healthiest subsystems: [list]
- Most problematic: [list]
```
