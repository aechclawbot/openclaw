# OASIS Ops — Phase Dependencies

## Dependency Graph

```
Phase 1 (Audit) ─── parallel ───> cleanup, log-review, security, monitor
       │
       ▼
Phase 2 (Test) ──── parallel ───> regression, dashboard-test
       │
       ▼
Phase 3 (Fix) ───── sequential ─> oasis-fix (consumes Phase 1+2 findings)
       │
       ▼
Phase 4 (Verify) ── parallel ───> regression (re-run), health check
       │
       ▼
Phase 5 (Document) ─ sequential ─> oasis-docs (consumes all findings)
       │
       ▼
Phase 6 (Commit) ── sequential ─> oasis-sync (all changes from Phases 3+5)
```

## Why This Order

- **Audit before Test**: Catches config/code issues that might cause false test failures
- **Fix after both**: Has complete picture of all issues before applying changes
- **Verify after Fix**: Confirms fixes didn't introduce regressions
- **Document after Verify**: Documents the actual working state, not a broken one
- **Commit last**: Groups all changes cleanly, never commits broken state

## Resource Budget

| Phase       | Concurrent Tasks | Est. Memory  | Est. Duration |
| ----------- | ---------------- | ------------ | ------------- |
| 1. Audit    | 4                | ~1.5GB total | 3-8 min       |
| 2. Test     | 2                | ~2GB total   | 5-15 min      |
| 3. Fix      | 1                | ~500MB       | 3-10 min      |
| 4. Verify   | 2                | ~1.5GB total | 3-8 min       |
| 5. Document | 1                | ~500MB       | 2-5 min       |
| 6. Commit   | 1                | ~200MB       | 1-3 min       |

**Total estimated wall-clock: 17-49 minutes**

Note: Unit tests (`pnpm test`) in Phase 2 are the longest step. Use `OPENCLAW_TEST_PROFILE=low` on the Mac Mini if memory pressure is observed.

## Abort Conditions

| Condition                                   | Action                                     |
| ------------------------------------------- | ------------------------------------------ |
| CRITICAL security finding (exposed secrets) | Stop all, alert immediately                |
| >10% unit test failure                      | Stop, investigate root cause before fixing |
| Fix phase introduces new test failures      | Roll back fixes, report                    |
| Any phase hangs >30 minutes                 | Kill and report                            |
| Disk space <5% free                         | Stop, alert                                |

## Skip Options

Individual phases can be skipped if not needed:

- Skip Phase 1 if audit was recently run
- Skip Phase 2 if tests were just run
- Skip Phase 5 if no docs changes needed
- Phase 3 (Fix) and Phase 6 (Commit) should not be skipped in a full ops run
