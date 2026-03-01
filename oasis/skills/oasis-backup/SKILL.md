---
name: oasis-backup
description: Verify OASIS backup integrity, check backup schedules, list backup inventory, and test restore readiness. Covers the nightly backup script, config backups, agent workspace backups, voice profile retention, and git remote health. Use when asked about backups, verify backup integrity, check if backups are running, list backups, or assess data safety.
metadata: { "openclaw": { "emoji": "💾" } }
---

# OASIS Backup Verification

Verify all backup mechanisms are functioning and data is recoverable.

## Backup Components

### 1. Nightly Backup Script

Launchd service: `com.openclaw.backup` (runs 3:00 AM daily)

```bash
# Verify service loaded
launchctl list | grep com.openclaw.backup

# Check recent log
tail -20 /tmp/openclaw-backup.log 2>/dev/null

# Last run time
stat -f '%Sm' /tmp/openclaw-backup.log 2>/dev/null
```

### 2. Critical Data Inventory

Check each critical data location exists, is non-empty, and was recently modified:

| Data                | Path                                         | Priority |
| ------------------- | -------------------------------------------- | -------- |
| Agent config        | `~/.openclaw/openclaw.json`                  | CRITICAL |
| Environment secrets | `/Users/oasis/openclaw/.env`                 | CRITICAL |
| Docker compose      | `/Users/oasis/openclaw/docker-compose.yml`   | HIGH     |
| OASIS Dockerfile    | `/Users/oasis/openclaw/Dockerfile.oasis`     | HIGH     |
| Agent workspaces    | `~/.openclaw/workspace-*`                    | HIGH     |
| Voice profiles      | `~/.openclaw/voice-profiles/`                | HIGH     |
| Voice transcripts   | `~/.openclaw/workspace-curator/transcripts/` | MEDIUM   |
| Dashboard todos     | `~/.openclaw/dashboard-todos.json`           | MEDIUM   |
| Agent sessions      | `~/.openclaw/agents/*/sessions/`             | MEDIUM   |
| Audio files         | `~/oasis-audio/done/`                        | MEDIUM   |
| Cron run history    | `~/.openclaw/cron/runs/`                     | LOW      |

```bash
for path in ~/.openclaw/openclaw.json /Users/oasis/openclaw/.env /Users/oasis/openclaw/docker-compose.yml; do
  if [ -f "$path" ]; then
    size=$(stat -f '%z' "$path")
    mod=$(stat -f '%Sm' "$path")
    echo "OK: $path ($size bytes, modified $mod)"
  else
    echo "MISSING: $path"
  fi
done

# Agent workspaces
ls -d ~/.openclaw/workspace-* 2>/dev/null | wc -l | xargs echo "Agent workspaces:"

# Voice profiles
ls ~/.openclaw/voice-profiles/*.json 2>/dev/null | wc -l | xargs echo "Voice profiles:"
```

### 3. Git Remote Health

The repo itself is a backup for all tracked files:

```bash
cd /Users/oasis/openclaw
git remote -v
git fetch origin --dry-run 2>&1 | head -5
git fetch upstream --dry-run 2>&1 | head -5
git log --oneline -3
```

Check for uncommitted critical changes:

```bash
git diff --stat docker-compose.yml Dockerfile.oasis AGENTS.md 2>/dev/null
```

### 4. Time Machine (if enabled)

```bash
tmutil status 2>/dev/null || echo "Time Machine not configured"
tmutil latestbackup 2>/dev/null || echo "No backup found"
```

## Verification Checklist

1. Backup service ran recently (within 24h)
2. All CRITICAL data files exist and are non-empty
3. Agent workspaces present for all expected agents
4. Voice profiles directory has enrolled speakers
5. `.env` file present with expected key count
6. Git remotes reachable (origin + upstream)
7. No uncommitted changes to critical config files

## Report

```
## Backup Report — [date]

### Backup Systems
| System | Status | Last Run | Notes |
|--------|--------|----------|-------|

### Critical Data Inventory
| Data | Exists | Size | Last Modified |
|------|--------|------|---------------|

### Git Remote Health
| Remote | Reachable | Notes |
|--------|-----------|-------|

### Recommendations
- [list backup gaps or improvements]
```
