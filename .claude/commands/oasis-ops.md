Run a full OASIS operations cycle. Follow the instructions in `skills/oasis-ops/SKILL.md` exactly.

This orchestrates ALL other oasis skills in 6 phased execution:

**Phase 1 — Audit (parallel):** Run cleanup, log-review, security, and monitor workflows
**Phase 2 — Test (parallel):** Run regression and dashboard-test workflows
**Phase 3 — Fix (sequential):** Apply fixes from Phase 1+2 findings
**Phase 4 — Verify (parallel):** Re-run regression + health check
**Phase 5 — Document (sequential):** Update documentation
**Phase 6 — Commit (sequential):** Git commit changes (NEVER push without confirmation)

Read `skills/oasis-ops/references/phase-dependencies.md` for the dependency graph and resource budget.

Abort conditions:

- CRITICAL security finding → stop immediately
- > 10% unit test failure → investigate first
- Fix phase introduces new failures → roll back
- Any phase hangs >30 min → kill and report

Report progress after each phase. Produce the unified OASIS Ops Report at the end.
