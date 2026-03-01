Run the OASIS full regression test suite. Follow the instructions in `oasis/skills/oasis-regression/SKILL.md` exactly.

Steps:

1. Read `oasis/skills/oasis-regression/SKILL.md`
2. Run unit tests: `pnpm test` (or with `OPENCLAW_TEST_PROFILE=low` if memory constrained)
3. Run health check: `scripts/oasis-health.sh --check`
4. Test gateway API (port 18789)
5. Test all dashboard API endpoints (run `oasis/skills/oasis-regression/scripts/test-dashboard-apis.sh` or test manually)
6. Check audio pipeline (listener health on :9001, PulseAudio, inbox/done counts)
7. Verify launchd services are loaded
8. Check cron job execution history
9. Produce the pass/fail Regression Report
