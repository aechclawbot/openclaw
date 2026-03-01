Run the OASIS issue resolution workflow. Follow the instructions in `oasis/skills/oasis-fix/SKILL.md` exactly.

If no findings are provided as input, first run `/oasis-log-review` and `/oasis-cleanup` to generate findings.

Steps:

1. Read `oasis/skills/oasis-fix/SKILL.md`
2. Collect findings from prior skill runs (or run audits first)
3. Triage each finding into Tier 1 (auto-fix), Tier 2 (confirm), or Tier 3 (manual/TODO)
4. Apply Tier 1 auto-fixes (formatting, container restarts, service reloads)
5. Present Tier 2 fixes for confirmation before applying
6. Create dashboard TODOs for Tier 3 items in `~/.openclaw/dashboard-todos.json`
7. Verify fixes by re-running originating checks
8. Produce the Fix Report
