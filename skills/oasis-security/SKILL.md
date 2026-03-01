---
name: oasis-security
description: Security audit for the OASIS deployment. Check for exposed secrets in code and config, verify Docker security (no privileged containers, proper socket proxy), review API authentication, check file permissions on sensitive directories, scan dependencies for vulnerabilities, and verify network exposure. Use when asked to audit security, check for exposed secrets, verify Docker security, review permissions, or scan for vulnerabilities.
metadata: { "openclaw": { "emoji": "🛡️" } }
---

# OASIS Security Audit

Comprehensive security review of the OASIS deployment.

## Audit Checklist

### 1. Secrets Exposure

Check for secrets in tracked files:

```bash
cd /Users/oasis/openclaw

# Search for potential secrets in tracked files (exclude .env, docs, node_modules)
git grep -iE "(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]" -- ':!.env' ':!*.md' ':!node_modules' ':!dist' ':!*.test.*' | grep -vE "(example|placeholder|test|mock|fake|<|TODO|process\.env|config\[)"

# Verify .env is gitignored
git check-ignore .env

# Check no secrets committed recently
git log --oneline -20 --diff-filter=A -- '*.env' '*.key' '*.pem' 'credentials*'
```

### 2. Docker Security

```bash
# Container security settings
for c in oasis oasis-dashboard audio-listener docker-proxy; do
  echo "=== $c ==="
  priv=$(docker inspect --format='{{.HostConfig.Privileged}}' "$c" 2>/dev/null)
  user=$(docker inspect --format='{{.Config.User}}' "$c" 2>/dev/null)
  ro=$(docker inspect --format='{{.HostConfig.ReadonlyRootfs}}' "$c" 2>/dev/null)
  echo "  Privileged: $priv"
  echo "  User: ${user:-root}"
  echo "  ReadonlyRootfs: $ro"
done
```

Verify docker-compose.yml:

- Docker socket proxy: `EXEC=0`, `BUILD=0`, `COMMIT=0` (restrict dangerous ops)
- `POST=1` enabled only for container management
- No containers mount `/var/run/docker.sock` directly (use proxy)
- Resource limits set (memory, cpus)

### 3. API Authentication

```bash
# Dashboard: unauthenticated should get 401 or limited response
echo "Dashboard unauth:"
curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000/api/agents 2>/dev/null

echo "Dashboard auth:"
curl -sf -o /dev/null -w "%{http_code}" -u "oasis:ReadyPlayer@1" http://localhost:3000/api/agents 2>/dev/null
```

### 4. File Permissions

```bash
# .env should not be world-readable
ls -la /Users/oasis/openclaw/.env 2>/dev/null

# Config directory
ls -la ~/.openclaw/openclaw.json 2>/dev/null

# Credentials directory
ls -la ~/.openclaw/credentials/ 2>/dev/null

# Voice profiles (biometric data)
ls -la ~/.openclaw/voice-profiles/ 2>/dev/null
```

Verify no files are world-readable (mode should be `600` or `640` for sensitive files).

### 5. Network Exposure

```bash
# Ports listening on all interfaces (not just localhost)
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -v '127.0.0.1\|localhost\|\[::1\]'
```

Expected: Dashboard on 3000 should be LAN-accessible. Gateway on 18789 should ideally be loopback-only.

### 6. Dependency Vulnerabilities

```bash
cd /Users/oasis/openclaw
pnpm audit 2>/dev/null || echo "pnpm audit not available"
```

### 7. Sensitive Data in Logs

Check that logs don't contain secrets:

```bash
grep -rliE "(api[_-]?key|bearer|authorization|password)" ~/.openclaw/logs/ 2>/dev/null | head -5
```

## Severity Classification

| Severity | Criteria                                                                 |
| -------- | ------------------------------------------------------------------------ |
| CRITICAL | Exposed secrets in tracked files, privileged containers, no auth on APIs |
| HIGH     | World-readable credentials, ports exposed to WAN, known CVEs             |
| MEDIUM   | Missing resource limits, verbose error messages, stale credentials       |
| LOW      | Missing security headers, informational leaks                            |

## Report

```
## Security Audit — [date]

### Critical Findings
- [exposed secrets, open ports, missing auth]

### High Severity
- [permission issues, CVEs]

### Medium Severity
- [missing limits, verbose errors]

### Low Severity
- [informational]

### Passed Checks
- [items that passed]

### Recommendations
- [prioritized improvements]
```

## Rules

- NEVER print actual secret values. Mask to first 4 chars + "\*\*\*".
- If secrets found in tracked files, flag as CRITICAL and recommend immediate rotation.
- Do not modify security settings without explicit approval.
- Do not run `pnpm audit --fix` automatically — report only.
