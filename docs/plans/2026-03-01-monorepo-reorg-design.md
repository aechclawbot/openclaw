# OASIS Monorepo Reorganization — Design Document

**Date:** 2026-03-01
**Status:** Approved
**Author:** Claude Code + Fred

## Problem

OASIS custom code (dashboard, audio pipeline, voice scripts, skills, ops scripts, docs) is intermingled with stock OpenClaw files at the repo root. This creates:

- Merge conflict risk on upstream `git pull`
- Confusion about what's ours vs upstream
- Risk of custom code getting clobbered by OpenClaw deployment to `~/.openclaw/`

## Decision: Single `oasis/` Namespace

All custom OASIS code moves under a single top-level `oasis/` directory. Upstream OpenClaw never creates this directory, so `git pull` will never touch it.

## What Moves

| Current Location                         | New Location                                       | Files | Notes                                       |
| ---------------------------------------- | -------------------------------------------------- | ----- | ------------------------------------------- |
| `~/.openclaw/workspace-oasis/dashboard/` | `oasis/dashboard/`                                 | ~80+  | Into git for the first time                 |
| `audio-listener/`                        | `oasis/audio-listener/`                            | 5     | Self-contained Python                       |
| `scripts/voice/`                         | `oasis/voice/scripts/`                             | 25    | Pipeline orchestrator, enrollment, etc.     |
| `scripts/voice/*.md`                     | `oasis/voice/docs/`                                | 3     | Audio guides                                |
| `scripts/voice/archived/`                | `oasis/voice/archived/`                            | ~10   | Legacy scripts                              |
| `skills/` (all 65)                       | `oasis/skills/`                                    | ~88   | All skills, both oasis-specific and generic |
| `prompts/`                               | `oasis/prompts/`                                   | 8     | Claude Code prompts                         |
| `scripts/oasis-*.sh`                     | `oasis/scripts/`                                   | 5     | Ops scripts                                 |
| `backup-openclaw.sh`                     | `oasis/scripts/`                                   | 1     | Backup script                               |
| `sync-plaud.sh`                          | `oasis/scripts/`                                   | 1     | Plaud sync                                  |
| `scripts/voice-activate.sh`              | `oasis/scripts/`                                   | 1     | Voice activation                            |
| `scripts/watch-folder.py`                | `oasis/voice/scripts/`                             | 1     | Folder watcher                              |
| `Dockerfile.oasis`                       | `oasis/docker/Dockerfile.oasis`                    | 1     | Custom Docker image                         |
| `docker-setup.sh`                        | `oasis/docker/docker-setup.sh`                     | 1     | Entrypoint                                  |
| `setup-podman.sh`                        | `oasis/docker/setup-podman.sh`                     | 1     | Podman alt                                  |
| `AGENTS.md`                              | `oasis/docs/AGENTS.md`                             | 1     | Agent definitions                           |
| `ARCHITECTURE_SPEC.md`                   | `oasis/docs/ARCHITECTURE_SPEC.md`                  | 1     | Tech spec                                   |
| `OASIS.md`                               | `oasis/docs/OASIS.md`                              | 1     | Quick reference                             |
| `VOICE_ASSISTANT_PLAN.md`                | `oasis/docs/VOICE_ASSISTANT_PLAN.md`               | 1     | Voice roadmap                               |
| `VOICE_DASHBOARD_INTEGRATION.md`         | `oasis/docs/VOICE_DASHBOARD_INTEGRATION.md`        | 1     | Dashboard integration                       |
| `OASIS_Stack_Expansion_Instructions.md`  | `oasis/docs/OASIS_Stack_Expansion_Instructions.md` | 1     | Expansion guide                             |
| `docs/plans/*-voice-*`                   | `oasis/docs/plans/`                                | 4     | Voice design docs                           |

## What Stays Put

- **`src/`** — upstream stock (2 documented modifications: `model-fallback.ts`, `timer.ts`)
- **`extensions/`** — upstream stock (voice-call patches stay volume-mounted from `extensions/`)
- **`apps/`, `docs/`, `ui/`, `vendor/`, `test/`, `assets/`** — all upstream
- **`scripts/` (non-oasis)** — upstream build/test/release scripts stay
- **`docker-compose.yml`** — stays at repo root for easy `docker compose` usage
- **`CLAUDE.md`** — stays at repo root (required by Claude Code), rewritten for new structure
- **`.env`** — stays at repo root
- **`.gitignore`** — stays at repo root, updated

## Target Structure

```
/Users/oasis/openclaw/
├── [all stock OpenClaw: src/, extensions/, apps/, docs/, ui/, etc.]
│
├── oasis/
│   ├── dashboard/                # Lit SPA + Express API
│   │   ├── server.js
│   │   ├── server/
│   │   ├── public/
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── audio-listener/           # Python VAD + transcription + speaker ID
│   │   ├── app.py
│   │   ├── assemblyai_transcriber.py
│   │   ├── speaker_verify.py
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   ├── voice/                    # Voice pipeline
│   │   ├── scripts/              # pipeline-orchestrator, enroll, reidentify, etc.
│   │   ├── archived/             # Legacy scripts
│   │   └── docs/                 # AUDIO_IMPORT_GUIDE, AUTOMATIC_PROFILES
│   │
│   ├── skills/                   # ALL 65 Claude Code skills
│   │   ├── oasis-ops/
│   │   ├── oasis-monitor/
│   │   ├── ... (all others)
│   │
│   ├── prompts/                  # Claude Code prompt templates
│   │
│   ├── scripts/                  # OASIS operational scripts
│   │   ├── oasis-up.sh
│   │   ├── oasis-weekly-update.sh
│   │   ├── oasis-health-alert.sh
│   │   ├── oasis-health.sh
│   │   ├── backup-openclaw.sh
│   │   ├── sync-plaud.sh
│   │   └── voice-activate.sh
│   │
│   ├── docker/                   # Docker infrastructure
│   │   ├── Dockerfile.oasis
│   │   ├── docker-setup.sh
│   │   └── setup-podman.sh
│   │
│   └── docs/                     # OASIS documentation
│       ├── AGENTS.md
│       ├── ARCHITECTURE_SPEC.md
│       ├── OASIS.md
│       ├── plans/
│       └── upstream-sync.md
│
├── docker-compose.yml            # Stays at root, paths updated
├── CLAUDE.md                     # Rewritten for new structure
├── .env                          # Stays at root
└── .gitignore                    # Updated
```

## Modified Upstream Files (Documented Exceptions)

| File                                              | Change                 | Lines   | Rationale                 |
| ------------------------------------------------- | ---------------------- | ------- | ------------------------- |
| `src/agents/model-fallback.ts`                    | Remove Ollama provider | +7      | No local LLM on OASIS     |
| `src/cron/service/timer.ts`                       | Session management fix | +42/-16 | Cron delivery reliability |
| `extensions/voice-call/src/manager.ts`            | Telnyx call control    | varies  | Two-way conversation      |
| `extensions/voice-call/src/webhook.ts`            | Webhook handling       | varies  | Telnyx integration        |
| `extensions/voice-call/src/providers/telnyx.ts`   | Provider fixes         | varies  | 3 critical patches        |
| `extensions/voice-call/src/response-generator.ts` | Response gen           | varies  | Voice response flow       |

Strategy: Keep in-place, document in `oasis/docs/upstream-sync.md`.

## Path Updates Required

### docker-compose.yml

- `oasis-dashboard` build context: `./oasis/dashboard` (was `~/.openclaw/workspace-oasis/dashboard`)
- `oasis-dashboard` volume mounts: `./oasis/dashboard/server.js:/app/server.js:ro` etc.
- `audio-listener` build context: `./oasis/audio-listener` (was `./audio-listener`)
- `audio-listener` volume mounts: `./oasis/audio-listener/app.py:/app/app.py:ro` etc.

### launchd plists (7 plists need path updates)

- `com.oasis.health-alert.plist` → `oasis/scripts/oasis-health-alert.sh`
- `com.oasis.transcript-sync.plist` → `oasis/voice/scripts/pipeline-orchestrator.py`
- `com.oasis.watch-folder.plist` → `oasis/voice/scripts/watch-folder.py`
- `com.oasis.nightly-import.plist` → archived (update or disable)
- `com.oasis.plaud-sync.plist` → `oasis/scripts/sync-plaud.sh`
- `com.openclaw.backup.plist` → `oasis/scripts/backup-openclaw.sh`
- `com.openclaw.oasis.plist` → `oasis/scripts/oasis-up.sh`
- `com.openclaw.weekly-update.plist` → `oasis/scripts/oasis-weekly-update.sh`
- `ai.openclaw.audio-import.plist` → `oasis/voice/scripts/import-audio.py` (archived)
- `ai.openclaw.voice-listener.plist` → `oasis/voice/scripts/listen.py` (archived)

### .claude/commands/ (11 files)

- All skill path references update from `skills/` to `oasis/skills/`

### Scripts (internal references)

- `oasis-weekly-update.sh` references `oasis-health.sh` via `$SCRIPT_DIR` — stays relative
- `oasis-up.sh` derives PROJECT_DIR from script location — stays relative

### CLAUDE.md

- Complete rewrite of project structure section
- AGENTS.md symlink → `oasis/docs/AGENTS.md`

## Migration Order

1. Dashboard (highest value, entirely our code)
2. Audio-listener (self-contained)
3. Voice scripts (scripts/voice/ → oasis/voice/)
4. Skills (all 65 → oasis/skills/)
5. OASIS scripts
6. Docker files
7. Documentation
8. Prompts
9. Update docker-compose.yml paths
10. Update launchd plists
11. Update .claude/commands/
12. Rewrite CLAUDE.md
13. Update .gitignore
14. Full validation

## Risks

1. **Dashboard path change** — Docker build context and volume mounts must all update atomically. Mitigation: update docker-compose.yml in same commit as the move.
2. **launchd services** — Must unload/reload all plists after path changes. Mitigation: script the unload/reload sequence.
3. **Skills discovery** — Claude Code may not find skills at new path. Mitigation: update .claude/commands/ references and test skill invocation.
