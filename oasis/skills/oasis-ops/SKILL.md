---
name: oasis-ops
description: Orchestrate a full OASIS operations cycle by running cleanup, testing, log review, security audit, issue resolution, documentation, and git sync in phased execution. Runs skills in dependency order with parallel phases where safe. Use when asked to run full ops, do a complete system check, run all OASIS skills, orchestrate the team, or do a comprehensive maintenance cycle.
metadata: { "openclaw": { "emoji": "🎯" } }
---

# OASIS Full Operations Orchestrator

Run a complete maintenance cycle across the entire OASIS stack.

## Execution Phases

See `references/phase-dependencies.md` for the full dependency graph and resource budget.

### Phase 1: Audit (parallel, 4 tasks)

Run these 4 audits. They are independent and can be run in parallel:

1. **Code Cleanup** — Run `/oasis-cleanup` workflow:
   - `pnpm format:fix`, `pnpm check`, `pnpm tsgo`
   - Check OASIS-specific files
   - Save findings

2. **Log Review** — Run `/oasis-log-review` workflow:
   - Parse all log sources
   - Classify by severity
   - Save findings

3. **Security Audit** — Run `/oasis-security` workflow:
   - Check secrets, Docker security, auth, permissions, deps
   - Save findings

4. **System Monitor** — Run `/oasis-monitor` workflow:
   - Container status, resource usage, port health, disk
   - Save snapshot

**ABORT CONDITION:** If security audit finds CRITICAL secrets exposure, stop all phases and alert immediately.

### Phase 2: Test (parallel, 2 tasks, after Phase 1)

1. **Full Regression** — Run `/oasis-regression` workflow:
   - Unit tests, container health, API tests, audio pipeline, launchd, cron
   - Save pass/fail matrix

2. **Dashboard Testing** — Run `/oasis-dashboard-test` workflow:
   - Page loads, API endpoints, functional tests
   - Save results

**ABORT CONDITION:** If >10% of unit tests fail, investigate before proceeding.

### Phase 3: Fix (sequential, after Phase 1+2)

Run `/oasis-fix` with all findings from Phase 1 and Phase 2:

- Apply Tier 1 auto-fixes (formatting, restarts)
- Present Tier 2 fixes for confirmation
- Create TODOs for Tier 3 manual items
- Save fix report

### Phase 4: Verify (parallel, 2 tasks, after Phase 3)

Re-run tests to confirm fixes:

1. **Regression Re-run** — Run the regression suite again
2. **Health Check** — Run `scripts/oasis-health.sh --check`

**ABORT CONDITION:** If fixes introduced new failures, roll back and report.

### Phase 5: Document (sequential, after Phase 4)

Run `/oasis-docs` workflow:

- Audit docs against current reality
- Update any stale sections
- Note what changed

### Phase 6: Commit (sequential, after Phase 5)

Run `/oasis-sync` workflow:

- Group all changes from this ops cycle
- Create logical commits with conventional messages
- **Do NOT push unless user explicitly confirms**

## Progress Reporting

After each phase, report:

```
Phase X (Name): COMPLETE — [summary]
  - [key findings/actions]
  - Duration: Xm
  Moving to Phase Y...
```

## Final Report

```
## OASIS Ops Report — [date]

### Phase Results
| Phase | Status | Duration | Key Findings |
|-------|--------|----------|-------------|
| 1. Audit | OK/WARN | Xm | ... |
| 2. Test | OK/FAIL | Xm | ... |
| 3. Fix | OK | Xm | X auto-fixed, Y confirmed, Z manual |
| 4. Verify | OK/FAIL | Xm | ... |
| 5. Document | OK | Xm | X files updated |
| 6. Commit | OK | Xm | X commits created |

### Issues Summary
- Found: X total
- Auto-fixed: Y
- Confirmed fixes: Z
- Pending manual: W

### Commits Created
[list from Phase 6]

### Pending Manual Items
[TODOs from Phase 3]
```

## Resource Limits

- Run phases sequentially (Phase 1 → 2 → 3 → 4 → 5 → 6)
- Within each parallel phase, run tasks concurrently
- Monitor memory pressure — Mac Mini has limited RAM shared with Docker containers
- If any phase takes >30 minutes, check for hangs

## Running Individual Skills

Each skill can be run independently:

- `/oasis-cleanup` — Code quality
- `/oasis-regression` — Full test suite
- `/oasis-dashboard-test` — Dashboard UI/API
- `/oasis-log-review` — Log analysis
- `/oasis-sync` — Git commit/sync
- `/oasis-fix` — Issue resolution
- `/oasis-docs` — Documentation
- `/oasis-monitor` — System status
- `/oasis-backup` — Backup health
- `/oasis-security` — Security audit
