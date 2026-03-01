---
name: oasis-monitor
description: Real-time system monitoring for the OASIS deployment. Display container status, resource usage (CPU, memory), port health, disk space, active sessions, audio pipeline status, and health alert state. Use when asked to monitor the system, watch status, check resource usage, show what is happening now, or get a system overview.
metadata: { "openclaw": { "emoji": "📡", "requires": { "bins": ["docker"] } } }
---

# OASIS Real-Time Monitor

Display live system status and resource usage.

## Quick Status Dashboard

```bash
echo "=== CONTAINERS ==="
for c in oasis oasis-dashboard audio-listener docker-proxy; do
  status=$(docker inspect --format='{{.State.Status}}' "$c" 2>/dev/null || echo "missing")
  health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" 2>/dev/null || echo "-")
  echo "  $c: $status ($health)"
done

echo ""
echo "=== PORTS ==="
for port in 18789 3000 9001; do
  nc -z -w 1 localhost $port 2>/dev/null && echo "  :$port OPEN" || echo "  :$port CLOSED"
done

echo ""
echo "=== DISK ==="
df -h /Users/oasis | tail -1 | awk '{print "  System: "$5" of "$2}'
du -sh ~/.openclaw 2>/dev/null | awk '{print "  ~/.openclaw: "$1}'
du -sh ~/oasis-audio 2>/dev/null | awk '{print "  ~/oasis-audio: "$1}'
```

## Container Resource Usage

```bash
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.PIDs}}" oasis oasis-dashboard audio-listener docker-proxy
```

## Audio Pipeline Status

```bash
# Listener health
curl -sf http://localhost:9001/health 2>/dev/null | python3 -m json.tool || echo "Audio listener unreachable"

# Queue depth
inbox=$(ls ~/oasis-audio/inbox/*.wav 2>/dev/null | wc -l | tr -d ' ')
done=$(ls ~/oasis-audio/done/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "Audio inbox: $inbox files, Done: $done transcripts"

# PulseAudio
test -S /tmp/pulseaudio.socket && echo "PulseAudio: socket OK" || echo "PulseAudio: socket MISSING"
```

## Launchd Services

```bash
echo "=== LAUNCHD ==="
launchctl list | grep -E "com\.(openclaw|oasis)|org\.pulseaudio|ai\.openclaw" | awk '{print "  "$3" (pid:"$1" exit:"$2")"}'
```

## Health Alert State

```bash
cat ~/.openclaw/health-alert-state.json 2>/dev/null | python3 -m json.tool || echo "No health-alert state file"
```

## Gateway Info

```bash
curl -sf --max-time 3 http://localhost:18789/health 2>/dev/null | python3 -m json.tool || echo "Gateway unreachable"
```

## Live Log Tailing

To follow logs in real-time (run these interactively):

```bash
# All Docker containers
docker compose logs -f --tail 20

# Specific container
docker logs -f --tail 50 oasis

# Host health alerts
tail -f ~/.openclaw/logs/health-alert.log

# Transcript sync
tail -f ~/.openclaw/logs/transcript-sync.log

# macOS unified logs
/Users/oasis/openclaw/scripts/clawlog.sh -f
```

## Notes

- `docker stats` without `--no-stream` runs continuously.
- Gateway health may return limited info without auth token.
- Audio listener quiet hours: check `LISTEN_QUIET_START`/`LISTEN_QUIET_END` env vars.
