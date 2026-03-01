# Upstream Sync Guide

## Overview

This repo is a fork of [OpenClaw](https://github.com/openclaw/openclaw).
All OASIS custom code lives under `oasis/`. Upstream `git pull` should
never touch `oasis/`.

## Remotes

- `origin`: https://github.com/aechclawbot/openclaw.git (our fork)
- `upstream`: https://github.com/openclaw/openclaw.git (stock OpenClaw)

## Sync Workflow

```bash
git fetch upstream
git merge upstream/main
```

## Modified Upstream Files

These files diverge from upstream and may cause merge conflicts:

### src/agents/model-fallback.ts

- **Change:** Removed Ollama provider from fallback chain (+7 lines)
- **Reason:** OASIS has no local LLM — cloud providers only
- **Conflict strategy:** Keep our version (remove Ollama lines after merge)

### src/cron/service/timer.ts

- **Change:** Session management improvements (+42/-16 lines)
- **Reason:** Cron delivery reliability for agent sessions
- **Conflict strategy:** Review upstream changes carefully, reapply our session fixes

### extensions/voice-call/src/ (4 files)

- `manager.ts` — Two-way Telnyx conversation management
- `webhook.ts` — Telnyx webhook handling
- `providers/telnyx.ts` — 3 critical Telnyx provider patches
- `response-generator.ts` — Voice response text generation
- **Reason:** Required for Telnyx two-way voice calls
- **Conflict strategy:** Volume-mounted into Docker. On conflict, compare upstream changes with our patches and reapply.
- **Note:** Pending upstream PR — once merged, remove volume mounts

## Weekly Auto-Update

`oasis/scripts/oasis-weekly-update.sh` runs every Sunday at 4 AM via launchd.
Fetches upstream, merges, builds, rebuilds Docker, runs QA health checks,
and sends Telegram notification. On merge conflict, aborts and notifies.
