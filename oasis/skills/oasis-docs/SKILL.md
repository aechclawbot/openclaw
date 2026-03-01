---
name: oasis-docs
description: Audit, generate, and update documentation for the OASIS deployment. Covers system architecture, operational runbooks, script documentation, launchd service inventory, cron job catalog, Docker setup, voice pipeline docs, dashboard API docs, and agent configuration. Updates CLAUDE.md/AGENTS.md and MEMORY.md as needed. Use when asked to document the system, update docs, create runbooks, audit documentation, or generate system overview.
metadata: { "openclaw": { "emoji": "📝" } }
---

# OASIS Documentation

Audit and update all OASIS deployment documentation.

## Documentation Inventory

### Repo-Level Docs

| File                                    | Purpose                            |
| --------------------------------------- | ---------------------------------- |
| `CLAUDE.md` / `AGENTS.md`               | Agent instructions, OASIS sections |
| `OASIS_Stack_Expansion_Instructions.md` | Stack expansion guide              |
| `VOICE_ASSISTANT_PLAN.md`               | Voice assistant design             |
| `VOICE_DASHBOARD_INTEGRATION.md`        | Dashboard voice integration        |

### Memory Files

| File                                                        | Purpose                    |
| ----------------------------------------------------------- | -------------------------- |
| `~/.claude/projects/-Users-oasis-openclaw/memory/MEMORY.md` | Claude Code project memory |

### Script Documentation

Every script in `oasis/scripts/oasis-*` should have a header comment block.

## Audit Workflow

### 1. Verify CLAUDE.md OASIS Sections

Cross-reference these sections against reality:

**Docker Operations section:**

```bash
docker compose config --services    # actual services
docker compose ps                    # actual container names/ports
```

**OASIS Log Locations:**

```bash
ls ~/.openclaw/logs/                 # actual log files
```

**Launchd services list:**

```bash
ls ~/Library/LaunchAgents/*oasis* ~/Library/LaunchAgents/*openclaw* ~/Library/LaunchAgents/*pulseaudio* ~/Library/LaunchAgents/*ai.openclaw* 2>/dev/null
```

**Agent list:**

```bash
ls ~/.openclaw/agents/               # actual agents
```

**Cron jobs:**

```bash
ls ~/.openclaw/cron/runs/*.jsonl 2>/dev/null | xargs -I{} basename {} .jsonl
```

Flag any discrepancies between docs and reality.

### 2. Verify Script Headers

For each `oasis/scripts/oasis-*.sh` and `oasis/voice/scripts/*.py`:

- Check that a header comment exists describing purpose, usage, dependencies
- Verify the description matches what the script actually does
- Check cron/launchd schedule documentation is accurate

### 3. Generate/Update Runbooks (if missing)

Create or update these operational docs:

1. **Startup Procedure** — How to bring up OASIS from cold boot
2. **Shutdown Procedure** — Graceful shutdown order
3. **Troubleshooting Guide** — Common issues and fixes
4. **Backup & Restore** — What's backed up, where, how to restore
5. **Update Procedure** — Weekly update flow, manual fallback

### 4. Update MEMORY.md

If infrastructure has changed (new containers, new services, new agents, changed ports):

- Update `~/.claude/projects/-Users-oasis-openclaw/memory/MEMORY.md`
- Keep it concise (under 200 lines)

### 5. Report

```
## Documentation Audit — [date]

### Accuracy Issues Found
- [file]: [what is wrong vs reality]

### Updates Made
- [file]: [what was changed]

### Missing Documentation
- [what needs to be created]

### Runbook Status
| Runbook | Status |
|---------|--------|
```

## Rules

- Do not add personal device names, hostnames, or real phone numbers to docs.
- Use placeholders for sensitive values.
- Keep CLAUDE.md OASIS sections consistent with the existing format.
- Documentation goes in the repo — except MEMORY.md which lives in `~/.claude/`.
- Do not create new .md files at repo root unless truly necessary — prefer updating existing docs.
