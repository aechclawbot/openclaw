# OASIS Monorepo Reorganization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all custom OASIS code into an `oasis/` top-level namespace so upstream `git pull` never touches our files.

**Architecture:** Single `oasis/` directory at repo root containing dashboard, audio-listener, voice scripts, skills, ops scripts, Docker configs, and docs. Stock OpenClaw files stay exactly where they are. `docker-compose.yml` stays at root for ergonomic `docker compose` usage.

**Tech Stack:** git mv, Docker Compose, launchd plists, bash, Python

**Key context:** The dashboard at `~/.openclaw/workspace-oasis/dashboard/` has its own `.git` — we copy files (not `.git/`) into the main repo. The voice-call extension patches stay volume-mounted from `extensions/` (not moved). Two modified upstream files (`src/agents/model-fallback.ts`, `src/cron/service/timer.ts`) stay in-place and are documented.

---

## Pre-Migration Checklist

Before starting, verify the system is healthy so you have a known-good baseline.

### Task 0: Verify System Health & Create Branch

**Step 1: Verify all Docker services are running**

Run: `cd /Users/oasis/openclaw && docker compose ps`
Expected: All 4 services (oasis, oasis-dashboard, audio-listener, docker-proxy) show "running" or "healthy"

**Step 2: Verify git is clean and up-to-date**

Run: `git status`
Expected: Working tree clean (untracked files OK — prompts/, screenshots)

Run: `git fetch upstream && git log upstream/main..HEAD --oneline | wc -l`
Expected: Shows number of commits ahead (should be ~33)

**Step 3: Create the reorg branch**

Run: `git checkout -b reorg/oasis-namespace`

**Step 4: Stop all Docker services (prevents file lock issues)**

Run: `docker compose down`
Expected: All services stopped

**Step 5: Stop all launchd services that reference scripts we'll move**

```bash
launchctl unload ~/Library/LaunchAgents/com.oasis.transcript-sync.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.oasis.health-alert.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.oasis.watch-folder.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.oasis.plaud-sync.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.oasis.nightly-import.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.openclaw.oasis.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.openclaw.weekly-update.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.openclaw.backup.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/ai.openclaw.audio-import.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist 2>/dev/null
```

**Step 6: Commit checkpoint (empty, marks the start)**

No commit needed — branch creation is the checkpoint.

---

## Task 1: Create Directory Skeleton

**Files:** Create directories only

**Step 1: Create all target directories**

```bash
cd /Users/oasis/openclaw
mkdir -p oasis/dashboard
mkdir -p oasis/audio-listener
mkdir -p oasis/voice/scripts
mkdir -p oasis/voice/archived
mkdir -p oasis/voice/docs
mkdir -p oasis/skills
mkdir -p oasis/prompts
mkdir -p oasis/scripts
mkdir -p oasis/docker
mkdir -p oasis/docs/plans
```

**Step 2: Verify structure**

Run: `find oasis -type d | sort`
Expected:

```
oasis
oasis/audio-listener
oasis/dashboard
oasis/docker
oasis/docs
oasis/docs/plans
oasis/prompts
oasis/scripts
oasis/skills
oasis/voice
oasis/voice/archived
oasis/voice/docs
oasis/voice/scripts
```

---

## Task 2: Dashboard Migration (HIGHEST PRIORITY)

The dashboard lives at `~/.openclaw/workspace-oasis/dashboard/` with its own `.git`. We copy files (excluding `.git/`, `node_modules/`, QA docs) into the repo.

**Step 1: Copy dashboard files into the repo (excluding .git and node_modules)**

```bash
cd /Users/oasis/openclaw

# Copy everything except .git, node_modules, and lock files
rsync -av --exclude='.git' --exclude='node_modules' --exclude='package-lock.json' \
  ~/.openclaw/workspace-oasis/dashboard/ oasis/dashboard/
```

**Step 2: Verify the copy**

Run: `ls oasis/dashboard/`
Expected: `server.js`, `server/`, `public/`, `package.json`, `Dockerfile`, `.dockerignore`, `.gitignore`, plus QA/cleanup docs

Run: `ls oasis/dashboard/server/routes/ | wc -l`
Expected: ~24 route files

Run: `ls oasis/dashboard/public/components/pages/ | wc -l`
Expected: ~11 page components

**Step 3: Git add the dashboard**

```bash
git add oasis/dashboard/
```

**Step 4: Update docker-compose.yml — dashboard build context**

In `docker-compose.yml`, update the `oasis-dashboard` service:

Old:

```yaml
oasis-dashboard:
  build:
    context: ${OPENCLAW_CONFIG_DIR}/workspace-oasis/dashboard
```

New:

```yaml
oasis-dashboard:
  build:
    context: ./oasis/dashboard
```

**Step 5: Update docker-compose.yml — dashboard volume mounts**

Old volume mounts referencing `${OPENCLAW_CONFIG_DIR}/workspace-oasis/dashboard/`:

```yaml
- ${OPENCLAW_CONFIG_DIR}/workspace-oasis/dashboard/server.js:/app/server.js:ro
- ${OPENCLAW_CONFIG_DIR}/workspace-oasis/dashboard/server:/app/server:ro
- ${OPENCLAW_CONFIG_DIR}/workspace-oasis/dashboard/public:/app/public:ro
```

New (relative to repo root):

```yaml
- ./oasis/dashboard/server.js:/app/server.js:ro
- ./oasis/dashboard/server:/app/server:ro
- ./oasis/dashboard/public:/app/public:ro
```

**Step 6: Verify dashboard builds**

```bash
docker compose build oasis-dashboard
```

Expected: Build succeeds

**Step 7: Commit**

```bash
git add docker-compose.yml oasis/dashboard/
git commit -m "feat(reorg): migrate dashboard into oasis/dashboard/

Move dashboard source from ~/.openclaw/workspace-oasis/dashboard/ into
the git repo at oasis/dashboard/. Update docker-compose.yml build
context and volume mounts to reference the new location."
```

---

## Task 3: Audio-Listener Migration

**Step 1: Move audio-listener into oasis/**

```bash
cd /Users/oasis/openclaw
git mv audio-listener/Dockerfile oasis/audio-listener/Dockerfile
git mv audio-listener/app.py oasis/audio-listener/app.py
git mv audio-listener/assemblyai_transcriber.py oasis/audio-listener/assemblyai_transcriber.py
git mv audio-listener/speaker_verify.py oasis/audio-listener/speaker_verify.py
```

Check for requirements.txt:

```bash
ls audio-listener/requirements.txt 2>/dev/null && git mv audio-listener/requirements.txt oasis/audio-listener/requirements.txt
```

**Step 2: Remove empty audio-listener/ directory**

```bash
rmdir audio-listener 2>/dev/null || true
```

**Step 3: Update docker-compose.yml — audio-listener build context**

Old:

```yaml
audio-listener:
  build:
    context: ./audio-listener
```

New:

```yaml
audio-listener:
  build:
    context: ./oasis/audio-listener
```

**Step 4: Update docker-compose.yml — audio-listener volume mounts**

Old:

```yaml
- ./audio-listener/app.py:/app/app.py:ro
- ./audio-listener/speaker_verify.py:/app/speaker_verify.py:ro
- ./audio-listener/assemblyai_transcriber.py:/app/assemblyai_transcriber.py:ro
```

New:

```yaml
- ./oasis/audio-listener/app.py:/app/app.py:ro
- ./oasis/audio-listener/speaker_verify.py:/app/speaker_verify.py:ro
- ./oasis/audio-listener/assemblyai_transcriber.py:/app/assemblyai_transcriber.py:ro
```

**Step 5: Verify audio-listener builds**

```bash
docker compose build audio-listener
```

Expected: Build succeeds

**Step 6: Commit**

```bash
git add -A oasis/audio-listener/ docker-compose.yml
git commit -m "feat(reorg): migrate audio-listener into oasis/audio-listener/

Move Python audio pipeline (VAD, AssemblyAI transcription, speaker ID)
from audio-listener/ to oasis/audio-listener/. Update docker-compose.yml
build context and volume mounts."
```

---

## Task 4: Voice Scripts Migration

**Step 1: Move active voice scripts**

```bash
cd /Users/oasis/openclaw

# Active scripts → oasis/voice/scripts/
for f in scripts/voice/pipeline-orchestrator.py \
         scripts/voice/sync-transcripts.py \
         scripts/voice/enroll_speaker.py \
         scripts/voice/reidentify_speakers.py \
         scripts/voice/label_speaker.py \
         scripts/voice/approve_speaker.py \
         scripts/voice/reject_speaker.py \
         scripts/voice/review_candidates.py \
         scripts/voice/retag_transcripts.py \
         scripts/voice/unknown_speaker_tracker.py \
         scripts/voice/stitch_conversations.py \
         scripts/voice/cleanup-short-transcripts.py \
         scripts/voice/backfill-assemblyai.py \
         scripts/voice/backfill-playback.py \
         scripts/voice/fix-profile-norms.py \
         scripts/voice/migrate-curator-backlog.py \
         scripts/voice/notify_new_candidates.sh \
         scripts/voice/watch-folder.py; do
  [ -f "$f" ] && git mv "$f" "oasis/voice/scripts/$(basename "$f")"
done
```

**Step 2: Move archived scripts**

```bash
for f in scripts/voice/archived/*; do
  [ -f "$f" ] && git mv "$f" "oasis/voice/archived/$(basename "$f")"
done
rmdir scripts/voice/archived 2>/dev/null || true
```

**Step 3: Move voice documentation**

```bash
for f in scripts/voice/README.md \
         scripts/voice/AUDIO_IMPORT_GUIDE.md \
         scripts/voice/AUTOMATIC_PROFILES.md; do
  [ -f "$f" ] && git mv "$f" "oasis/voice/docs/$(basename "$f")"
done
```

**Step 4: Clean up empty scripts/voice/ directory**

```bash
# Move any remaining files
for f in scripts/voice/*; do
  [ -f "$f" ] && git mv "$f" "oasis/voice/scripts/$(basename "$f")"
done
rmdir scripts/voice 2>/dev/null || true
```

**Step 5: Verify**

Run: `ls oasis/voice/scripts/ | wc -l`
Expected: ~17 script files

Run: `ls oasis/voice/archived/ | wc -l`
Expected: ~10 archived files

Run: `ls oasis/voice/docs/`
Expected: README.md, AUDIO_IMPORT_GUIDE.md, AUTOMATIC_PROFILES.md

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(reorg): migrate voice scripts into oasis/voice/

Move scripts/voice/ to oasis/voice/ with subdirectories:
- scripts/ (active pipeline scripts)
- archived/ (legacy scripts)
- docs/ (audio pipeline documentation)"
```

---

## Task 5: Skills Migration

**Step 1: Move ALL skills into oasis/skills/**

```bash
cd /Users/oasis/openclaw

# Move each skill directory
for d in skills/*/; do
  skill_name=$(basename "$d")
  git mv "skills/$skill_name" "oasis/skills/$skill_name"
done
```

**Step 2: Remove empty skills/ directory**

```bash
rmdir skills 2>/dev/null || true
```

**Step 3: Update .claude/commands/ to reference new skill paths**

Each file in `.claude/commands/` references `skills/<name>/SKILL.md`. Update all 11 files:

```bash
for f in .claude/commands/oasis-*.md; do
  # Replace "skills/" with "oasis/skills/" in each file
  sed -i '' 's|skills/|oasis/skills/|g' "$f"
done
```

**Step 4: Verify skill references**

Run: `grep -r "skills/" .claude/commands/ | grep -v "oasis/skills/"`
Expected: No output (all references updated)

Run: `ls oasis/skills/ | wc -l`
Expected: 62 (or however many skills exist)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(reorg): migrate all skills into oasis/skills/

Move all 62 Claude Code skills from skills/ to oasis/skills/.
Update .claude/commands/ references to new paths."
```

---

## Task 6: OASIS Operations Scripts Migration

**Step 1: Move OASIS-specific scripts from scripts/**

```bash
cd /Users/oasis/openclaw

for f in scripts/oasis-up.sh \
         scripts/oasis-weekly-update.sh \
         scripts/oasis-health-alert.sh \
         scripts/oasis-health.sh \
         scripts/voice-activate.sh \
         scripts/docker-secrets-entrypoint.sh \
         scripts/keychain-store.sh; do
  [ -f "$f" ] && git mv "$f" "oasis/scripts/$(basename "$f")"
done
```

**Step 2: Move root-level OASIS scripts**

```bash
for f in backup-openclaw.sh sync-plaud.sh; do
  [ -f "$f" ] && git mv "$f" "oasis/scripts/$f"
done
```

**Step 3: Verify**

Run: `ls oasis/scripts/`
Expected: oasis-up.sh, oasis-weekly-update.sh, oasis-health-alert.sh, oasis-health.sh, voice-activate.sh, docker-secrets-entrypoint.sh, keychain-store.sh, backup-openclaw.sh, sync-plaud.sh

**Step 4: Update internal script references**

The `oasis-weekly-update.sh` references `oasis-health.sh` via `$SCRIPT_DIR`. Since both are now in the same directory (`oasis/scripts/`), the `$SCRIPT_DIR` relative reference still works. Verify:

Run: `grep 'SCRIPT_DIR\|HEALTH_SCRIPT\|oasis-health' oasis/scripts/oasis-weekly-update.sh`
Expected: Uses `$SCRIPT_DIR/oasis-health.sh` — this resolves correctly since both files moved together.

The `oasis-up.sh` derives `PROJECT_DIR` from `$SCRIPT_DIR/..`. After the move, `$SCRIPT_DIR` is `oasis/scripts/`, so `$SCRIPT_DIR/..` is `oasis/` — NOT the repo root. **This needs fixing.**

Edit `oasis/scripts/oasis-up.sh`: Change `PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"` to `PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"` (go up two levels: oasis/scripts/ → oasis/ → repo root).

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(reorg): migrate OASIS ops scripts into oasis/scripts/

Move oasis-*.sh, backup, plaud sync, voice-activate, docker-entrypoint,
and keychain scripts from scripts/ and repo root to oasis/scripts/.
Fix oasis-up.sh PROJECT_DIR to account for new depth."
```

---

## Task 7: Docker Infrastructure Files Migration

**Step 1: Move Docker files**

```bash
cd /Users/oasis/openclaw

git mv Dockerfile.oasis oasis/docker/Dockerfile.oasis
[ -f docker-setup.sh ] && git mv docker-setup.sh oasis/docker/docker-setup.sh
[ -f setup-podman.sh ] && git mv setup-podman.sh oasis/docker/setup-podman.sh
```

**Step 2: Update docker-compose.yml if it references Dockerfile.oasis by path**

Check: `grep -n 'Dockerfile.oasis' docker-compose.yml`

If the gateway service uses `dockerfile: Dockerfile.oasis`, update to `dockerfile: oasis/docker/Dockerfile.oasis` (or use a relative path from the build context).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(reorg): migrate Docker configs into oasis/docker/

Move Dockerfile.oasis, docker-setup.sh, setup-podman.sh to
oasis/docker/."
```

---

## Task 8: Documentation Migration

**Step 1: Move OASIS-specific markdown docs from repo root**

```bash
cd /Users/oasis/openclaw

git mv AGENTS.md oasis/docs/AGENTS.md
git mv ARCHITECTURE_SPEC.md oasis/docs/ARCHITECTURE_SPEC.md
git mv OASIS.md oasis/docs/OASIS.md
[ -f VOICE_ASSISTANT_PLAN.md ] && git mv VOICE_ASSISTANT_PLAN.md oasis/docs/VOICE_ASSISTANT_PLAN.md
[ -f VOICE_DASHBOARD_INTEGRATION.md ] && git mv VOICE_DASHBOARD_INTEGRATION.md oasis/docs/VOICE_DASHBOARD_INTEGRATION.md
[ -f OASIS_Stack_Expansion_Instructions.md ] && git mv OASIS_Stack_Expansion_Instructions.md oasis/docs/OASIS_Stack_Expansion_Instructions.md
[ -f pipeline_analysis.md ] && git mv pipeline_analysis.md oasis/docs/pipeline_analysis.md
```

**Step 2: Move voice pipeline design docs**

```bash
for f in docs/plans/2026-03-01-voice-pipeline-*.md; do
  [ -f "$f" ] && git mv "$f" "oasis/docs/plans/$(basename "$f")"
done
```

Note: Keep `docs/plans/2026-03-01-monorepo-reorg*.md` in `docs/plans/` — these are about the reorg itself and serve as reference for the migration.

**Step 3: Move image assets related to OASIS**

```bash
for f in oasis-architecture.png speakers-tab.png transcript-edit-active.png \
         transcript-edit-mode.png transcript-modal.png; do
  [ -f "$f" ] && git mv "$f" "oasis/docs/$f"
done
```

**Step 4: Fix CLAUDE.md symlink**

The current `CLAUDE.md` is a symlink to `AGENTS.md`. Since AGENTS.md moved to `oasis/docs/AGENTS.md`, the symlink breaks.

```bash
# Remove old symlink
rm CLAUDE.md
# Create new symlink
ln -s oasis/docs/AGENTS.md CLAUDE.md
git add CLAUDE.md
```

**Step 5: Verify**

Run: `ls -la CLAUDE.md`
Expected: `CLAUDE.md -> oasis/docs/AGENTS.md`

Run: `cat CLAUDE.md | head -5`
Expected: Shows AGENTS.md content (symlink works)

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(reorg): migrate OASIS docs into oasis/docs/

Move AGENTS.md, ARCHITECTURE_SPEC.md, OASIS.md, voice plans, and
image assets to oasis/docs/. Update CLAUDE.md symlink."
```

---

## Task 9: Prompts Migration

**Step 1: Move all prompts**

```bash
cd /Users/oasis/openclaw

for f in prompts/oasis-*.md; do
  [ -f "$f" ] && git mv "$f" "oasis/prompts/$(basename "$f")"
done
```

**Step 2: Check for non-oasis prompts in prompts/**

```bash
ls prompts/ 2>/dev/null
```

If empty: `rmdir prompts`
If other files remain: leave them (they may be upstream).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(reorg): migrate prompts into oasis/prompts/"
```

---

## Task 10: Update Upstream-Modified Files Documentation

**Step 1: Create oasis/docs/upstream-sync.md**

Create file `oasis/docs/upstream-sync.md`:

````markdown
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
# OR: git rebase upstream/main (if preferred)
```
````

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
- **Conflict strategy:** These are volume-mounted into Docker. On conflict,
  compare upstream changes with our patches and reapply.
- **Note:** Pending upstream PR — once merged, remove volume mounts

## Upstream Commit Baseline

Run `git merge-base HEAD upstream/main` to find the common ancestor.

## Weekly Auto-Update

`scripts/oasis-weekly-update.sh` (now at `oasis/scripts/oasis-weekly-update.sh`)
runs every Sunday at 4 AM via launchd. It fetches upstream, merges, builds,
rebuilds Docker, runs QA health checks, and sends Telegram notification.
On merge conflict, it aborts and notifies — manual resolution required.

````

**Step 2: Commit**

```bash
git add oasis/docs/upstream-sync.md
git commit -m "docs: add upstream sync guide with modified file inventory"
````

---

## Task 11: Update .gitignore

**Step 1: Add oasis-specific ignores**

Add to `.gitignore`:

```
# OASIS dashboard
oasis/dashboard/node_modules/
oasis/dashboard/package-lock.json

# Python
__pycache__/
*.pyc
```

**Step 2: Verify nothing critical is ignored**

Run: `git status`
Expected: No oasis/ files unexpectedly ignored

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore for oasis/ namespace"
```

---

## Task 12: Update launchd Plists

All launchd plists that reference moved scripts need path updates. The plists live at `~/Library/LaunchAgents/` (outside the repo), so these are manual edits.

**Step 1: Update com.openclaw.oasis.plist**

Old path: `/Users/oasis/openclaw/scripts/oasis-up.sh`
New path: `/Users/oasis/openclaw/oasis/scripts/oasis-up.sh`

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/oasis-up.sh|/Users/oasis/openclaw/oasis/scripts/oasis-up.sh|g' \
  ~/Library/LaunchAgents/com.openclaw.oasis.plist
```

**Step 2: Update com.openclaw.weekly-update.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/oasis-weekly-update.sh|/Users/oasis/openclaw/oasis/scripts/oasis-weekly-update.sh|g' \
  ~/Library/LaunchAgents/com.openclaw.weekly-update.plist
```

**Step 3: Update com.oasis.health-alert.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/oasis-health-alert.sh|/Users/oasis/openclaw/oasis/scripts/oasis-health-alert.sh|g' \
  ~/Library/LaunchAgents/com.oasis.health-alert.plist
```

**Step 4: Update com.oasis.transcript-sync.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/voice/pipeline-orchestrator.py|/Users/oasis/openclaw/oasis/voice/scripts/pipeline-orchestrator.py|g' \
  ~/Library/LaunchAgents/com.oasis.transcript-sync.plist
```

**Step 5: Update com.oasis.watch-folder.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/voice/watch-folder.py|/Users/oasis/openclaw/oasis/voice/scripts/watch-folder.py|g' \
  ~/Library/LaunchAgents/com.oasis.watch-folder.plist
```

**Step 6: Update com.oasis.nightly-import.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/voice/nightly-import.sh|/Users/oasis/openclaw/oasis/voice/archived/nightly-import.sh|g' \
  ~/Library/LaunchAgents/com.oasis.nightly-import.plist
```

**Step 7: Update com.oasis.plaud-sync.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/sync-plaud.sh|/Users/oasis/openclaw/oasis/scripts/sync-plaud.sh|g' \
  ~/Library/LaunchAgents/com.oasis.plaud-sync.plist
```

**Step 8: Update com.openclaw.backup.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/backup-openclaw.sh|/Users/oasis/openclaw/oasis/scripts/backup-openclaw.sh|g' \
  ~/Library/LaunchAgents/com.openclaw.backup.plist
```

**Step 9: Update ai.openclaw.audio-import.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/voice/import-audio.py|/Users/oasis/openclaw/oasis/voice/archived/import-audio.py|g' \
  ~/Library/LaunchAgents/ai.openclaw.audio-import.plist
```

**Step 10: Update ai.openclaw.voice-listener.plist**

```bash
sed -i '' 's|/Users/oasis/openclaw/scripts/voice/listen.py|/Users/oasis/openclaw/oasis/voice/archived/listen.py|g' \
  ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist
```

**Step 11: Verify all plists updated**

```bash
grep -r "/Users/oasis/openclaw/scripts/" ~/Library/LaunchAgents/com.oasis.*.plist \
  ~/Library/LaunchAgents/com.openclaw.*.plist \
  ~/Library/LaunchAgents/ai.openclaw.*.plist 2>/dev/null
```

Expected: No matches referencing old `scripts/` paths (only `oasis/scripts/` or `oasis/voice/`)

Also verify no references to root-level files that moved:

```bash
grep -r "openclaw/backup-openclaw.sh\|openclaw/sync-plaud.sh\|openclaw/Dockerfile.oasis" \
  ~/Library/LaunchAgents/*.plist 2>/dev/null | grep -v "oasis/"
```

Expected: No matches

---

## Task 13: Update CLAUDE.md

The CLAUDE.md symlink now points to `oasis/docs/AGENTS.md`. However, the CLAUDE.md at the repo root is the one Claude Code reads. The main project instructions are in a separate CLAUDE.md that is NOT the AGENTS.md symlink — it's the large file with repo guidelines.

**Step 1: Check current CLAUDE.md situation**

```bash
ls -la /Users/oasis/openclaw/CLAUDE.md
cat /Users/oasis/openclaw/CLAUDE.md | head -5
```

If CLAUDE.md is the symlink to AGENTS.md, then the real project instructions are loaded from somewhere else (likely `.agents/` or the repo has both). Verify and update accordingly.

**Step 2: Update the project structure section in CLAUDE.md (or AGENTS.md)**

Add/update the section that describes the repo structure to reflect the `oasis/` namespace:

```markdown
## OASIS Custom Code — oasis/ Namespace

All custom OASIS code lives under the `oasis/` top-level directory.
Upstream `git pull` will never touch this directory.

- `oasis/dashboard/` — Lit SPA + Express API (port 3000)
- `oasis/audio-listener/` — Python VAD + transcription + speaker ID (port 9001)
- `oasis/voice/scripts/` — Voice pipeline management scripts
- `oasis/voice/archived/` — Legacy voice scripts
- `oasis/voice/docs/` — Audio pipeline documentation
- `oasis/skills/` — All 62 Claude Code skills
- `oasis/prompts/` — Claude Code prompt templates
- `oasis/scripts/` — OASIS operational scripts (health, backup, update, etc.)
- `oasis/docker/` — Dockerfile.oasis, setup scripts
- `oasis/docs/` — AGENTS.md, ARCHITECTURE_SPEC.md, upstream-sync.md, plans/

Stock OpenClaw files remain at the repo root (`src/`, `extensions/`, `apps/`, etc.).
Do NOT move or modify upstream files without documenting in `oasis/docs/upstream-sync.md`.
```

**Step 3: Commit**

```bash
git add CLAUDE.md oasis/docs/AGENTS.md
git commit -m "docs: update CLAUDE.md for oasis/ namespace"
```

---

## Task 14: Update Skill Files With New Paths

Several oasis-specific skills reference hardcoded paths that have changed.

**Step 1: Find all path references in skills**

```bash
grep -r "/Users/oasis/openclaw/scripts/" oasis/skills/ --include="*.md" -l
grep -r "audio-listener/" oasis/skills/ --include="*.md" -l
grep -r "scripts/voice/" oasis/skills/ --include="*.md" -l
grep -r "skills/" oasis/skills/ --include="*.md" | grep -v "oasis/skills/" | head -20
```

**Step 2: Update paths in each affected skill**

For each skill file found in Step 1, update:

- `scripts/oasis-health.sh` → `oasis/scripts/oasis-health.sh`
- `scripts/oasis-up.sh` → `oasis/scripts/oasis-up.sh`
- `scripts/voice/` → `oasis/voice/scripts/`
- `audio-listener/` → `oasis/audio-listener/`
- `scripts/clawlog.sh` → stays (this is an upstream script)
- `skills/` → `oasis/skills/` (for cross-references between skills)

Use sed for bulk updates:

```bash
find oasis/skills/ -name "*.md" -exec sed -i '' \
  -e 's|scripts/oasis-health\.sh|oasis/scripts/oasis-health.sh|g' \
  -e 's|scripts/oasis-up\.sh|oasis/scripts/oasis-up.sh|g' \
  -e 's|scripts/oasis-weekly-update\.sh|oasis/scripts/oasis-weekly-update.sh|g' \
  -e 's|scripts/oasis-health-alert\.sh|oasis/scripts/oasis-health-alert.sh|g' \
  -e 's|scripts/voice/|oasis/voice/scripts/|g' \
  -e 's|audio-listener/|oasis/audio-listener/|g' \
  {} \;
```

**Be careful:** Don't replace paths that refer to Docker container internal paths (like `/app/audio-listener/` or `/audio/`). Review the diff.

**Step 3: Verify**

```bash
git diff oasis/skills/ --stat
```

Review changes to ensure only file path references changed, not Docker container paths or external URLs.

**Step 4: Commit**

```bash
git add oasis/skills/
git commit -m "fix(reorg): update skill file paths for oasis/ namespace"
```

---

## Task 15: Full Stack Validation

**Step 1: Verify git status is clean**

```bash
git status
```

Expected: Clean working tree (untracked files OK)

**Step 2: Verify directory structure**

```bash
ls oasis/
```

Expected: `audio-listener/  dashboard/  docker/  docs/  prompts/  scripts/  skills/  voice/`

**Step 3: Verify old locations are gone**

```bash
ls -d audio-listener/ 2>/dev/null && echo "FAIL: audio-listener still at root" || echo "OK"
ls -d skills/ 2>/dev/null && echo "FAIL: skills still at root" || echo "OK"
ls AGENTS.md 2>/dev/null && echo "FAIL: AGENTS.md still at root" || echo "OK (symlink expected)"
ls Dockerfile.oasis 2>/dev/null && echo "FAIL: Dockerfile.oasis still at root" || echo "OK"
ls backup-openclaw.sh 2>/dev/null && echo "FAIL: backup script still at root" || echo "OK"
ls sync-plaud.sh 2>/dev/null && echo "FAIL: plaud sync still at root" || echo "OK"
```

**Step 4: Build and start all Docker services**

```bash
cd /Users/oasis/openclaw
docker compose build
docker compose up -d
```

Expected: All services build and start successfully

**Step 5: Verify each service is healthy**

```bash
# Wait for startup
sleep 15

# Check all containers
docker compose ps

# Check dashboard is responding
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: All containers running, dashboard returns 200 (or 401 if auth required)

**Step 6: Check audio-listener health endpoint**

```bash
curl -s http://localhost:9001/health
```

Expected: Health response (JSON)

**Step 7: Reload launchd services**

```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.oasis.plist
launchctl load ~/Library/LaunchAgents/com.oasis.health-alert.plist
launchctl load ~/Library/LaunchAgents/com.oasis.transcript-sync.plist
launchctl load ~/Library/LaunchAgents/com.oasis.watch-folder.plist
launchctl load ~/Library/LaunchAgents/com.oasis.plaud-sync.plist
launchctl load ~/Library/LaunchAgents/com.openclaw.weekly-update.plist
launchctl load ~/Library/LaunchAgents/com.openclaw.backup.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.audio-import.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.voice-listener.plist
launchctl load ~/Library/LaunchAgents/com.oasis.nightly-import.plist
```

**Step 8: Verify launchd services are loaded**

```bash
launchctl list | grep -E "oasis|openclaw"
```

Expected: All services listed (some may show exit code 0 if they're interval-based)

**Step 9: Test upstream merge compatibility**

```bash
git stash  # if any uncommitted changes
git fetch upstream
git merge upstream/main --no-commit --no-ff
```

Expected: Merge succeeds with no conflicts in `oasis/` directory

```bash
git merge --abort  # don't actually merge, just testing
git stash pop 2>/dev/null  # restore any stashed changes
```

**Step 10: Final commit log review**

```bash
git log --oneline reorg/oasis-namespace --not main
```

Expected: ~12-15 clean commits documenting each migration step

---

## Task 16: Update Memory & Documentation

**Step 1: Update the MEMORY.md with new structure**

The auto-memory at `~/.claude/projects/-Users-oasis-openclaw/memory/MEMORY.md` has several path references that need updating:

- Dashboard code: `~/.openclaw/workspace-oasis/dashboard/` → `oasis/dashboard/` (in repo)
- `services/dashboard/` reference → already deleted, remove mention
- Audio pipeline references to `scripts/voice/` → `oasis/voice/scripts/`

**Step 2: Commit final documentation**

```bash
git add -A
git commit -m "docs: update documentation and memory for oasis/ namespace"
```

---

## Summary Statistics

| Classification               | File Count     | Action                                 |
| ---------------------------- | -------------- | -------------------------------------- |
| **Dashboard**                | ~80 files      | Copied into repo at `oasis/dashboard/` |
| **Audio-listener**           | 4 files        | git mv to `oasis/audio-listener/`      |
| **Voice scripts (active)**   | ~17 files      | git mv to `oasis/voice/scripts/`       |
| **Voice scripts (archived)** | ~10 files      | git mv to `oasis/voice/archived/`      |
| **Voice docs**               | 3 files        | git mv to `oasis/voice/docs/`          |
| **Skills**                   | 62 directories | git mv to `oasis/skills/`              |
| **Prompts**                  | 8 files        | git mv to `oasis/prompts/`             |
| **OASIS scripts**            | 9 files        | git mv to `oasis/scripts/`             |
| **Docker files**             | 3 files        | git mv to `oasis/docker/`              |
| **Documentation**            | ~10 files      | git mv to `oasis/docs/`                |
| **Image assets**             | ~5 files       | git mv to `oasis/docs/`                |
| **OpenClaw stock**           | ~5,000+ files  | NOT MOVED                              |
| **Modified upstream**        | 6 files        | Stays in-place, documented             |

**Total files moved/copied:** ~210
**Estimated complexity:** Medium
**launchd plists to update:** 10
**Docker services to rebuild:** 2 (dashboard, audio-listener)

### Top 3 Risks

1. **Dashboard Docker build** — new build context may miss files. Mitigation: verify `docker compose build oasis-dashboard` before proceeding.
2. **launchd path breakage** — any missed plist update stops a background service silently. Mitigation: verify with `launchctl list` and check logs.
3. **Skill path references** — Claude Code may not find skills if `.claude/commands/` references are stale. Mitigation: grep for old paths after migration.

### Confirmed

- `git pull upstream main` will NOT touch `oasis/` — upstream has no `oasis/` directory
- `docker-compose.yml` stays at repo root — daily workflow unchanged
- `.env` stays at repo root — no secret rotation needed
