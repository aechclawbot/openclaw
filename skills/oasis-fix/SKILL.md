---
name: oasis-fix
description: Resolve issues found by other OASIS skills (cleanup, regression, log-review, dashboard-test, security). Takes findings as input, categorizes by type (code, config, infra, docs), applies safe auto-fixes, creates TODO items for manual fixes, and verifies fixes do not break other things. Use when asked to fix issues, resolve problems, apply fixes from audit, or remediate findings.
metadata: { "openclaw": { "emoji": "🔧" } }
---

# OASIS Issue Resolution

Take findings from audit/test/review skills and systematically resolve them.

## Input

Accept findings from any combination of:

- `/oasis-cleanup` (lint errors, type errors, dead code)
- `/oasis-regression` (test failures, health check failures)
- `/oasis-log-review` (error patterns, stale services)
- `/oasis-dashboard-test` (broken pages, API failures)
- `/oasis-security` (exposed secrets, permission issues)

If no prior findings are provided, run `/oasis-log-review` and `/oasis-cleanup` first to generate findings.

## Issue Tiers

### Tier 1: Auto-Fix Safe (apply without asking)

- Formatting issues (oxfmt)
- Import ordering (oxlint auto-fix)
- Trailing whitespace, missing newlines
- Stale Docker containers → `docker compose restart <service>`
- Unloaded launchd services → `launchctl load ~/Library/LaunchAgents/<plist>`

### Tier 2: Fix With Confirmation (ask first)

- Type errors requiring code changes
- Config file corrections (docker-compose.yml, openclaw.json)
- Script bug fixes (shell, Python)
- Dashboard code changes (server.js routes, page components)
- Docker image rebuild needed

### Tier 3: Manual Only (create TODO + report)

- Architecture changes
- Dependency version updates
- Upstream merge conflicts
- Security vulnerabilities requiring upstream patches
- Hardware or network issues
- Changes that require testing on real devices

## Workflow

### 1. Triage

For each finding:

1. Read the source code around the error
2. Categorize into Tier 1, 2, or 3
3. Estimate blast radius (what else could break)

### 2. Apply Tier 1 Fixes

```bash
cd /Users/oasis/openclaw
pnpm format:fix    # formatting
```

For infrastructure:

```bash
docker compose restart <service>
launchctl load ~/Library/LaunchAgents/<service>.plist
```

### 3. Apply Tier 2 Fixes (with confirmation)

For each:

1. Show the exact change to be made
2. Wait for user approval
3. Apply the change
4. Run relevant test to verify

### 4. Create TODOs for Tier 3

Write to `~/.openclaw/dashboard-todos.json`:

```json
{
  "id": "<uuid>",
  "title": "<short description>",
  "description": "<full context and recommended fix>",
  "status": "pending",
  "priority": "high",
  "context": "oasis-fix",
  "created_at": "<ISO timestamp>",
  "completed_at": null
}
```

Read the existing file first, append the new item, write back as a flat JSON array.

### 5. Verification

After applying fixes:

1. Re-run the check that found the issue
2. Run `pnpm test` if code was changed
3. Run `scripts/oasis-health.sh --check` if infra was changed
4. Confirm no new issues introduced

## Report

```
## Fix Report — [date]

### Tier 1: Auto-Fixed
- [count] formatting issues
- [count] containers restarted
- [count] services reloaded

### Tier 2: Fixed With Confirmation
- [list with before/after]

### Tier 3: TODOs Created
- [list of items added to dashboard-todos.json]

### Verification
- All checks pass: YES/NO
- New issues introduced: [list or "none"]
```

## Rules

- Never fix semantic logic without confirmation.
- Never modify `.env` or credentials files.
- Always re-run the originating check after fixing.
- If a fix could affect multiple subsystems, run full health check after.
- Dashboard code at `~/.openclaw/workspace-oasis/dashboard/` requires Docker restart after changes.
