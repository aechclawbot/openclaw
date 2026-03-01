Run the OASIS log analysis workflow. Follow the instructions in `oasis/skills/oasis-log-review/SKILL.md` exactly.

Steps:

1. Read `oasis/skills/oasis-log-review/SKILL.md`
2. Parse all host logs in `~/.openclaw/logs/` (15+ files)
3. Check Docker container logs (`docker logs --since 1h` for each container)
4. Review most recent agent session logs for errors
5. Check cron run logs for failures
6. Check transient logs in `/tmp/`
7. Read health alert state
8. Classify all findings by severity: CRITICAL / HIGH / MEDIUM / LOW
9. Produce the severity-ranked Log Review Report
