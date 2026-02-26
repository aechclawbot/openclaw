# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** `AGENTS.md` has full upstream maintainer instructions; keep both files in sync.

## Project Overview

OpenClaw is a multi-channel AI gateway with extensible messaging integrations. It's a personal AI assistant you run on your own devices, answering on channels you already use (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Matrix, and more).

## Tech Stack

- **Runtime**: Node 22+ (Bun also supported for dev/scripts)
- **Language**: TypeScript (ESM, strict mode)
- **Package Manager**: pnpm 10+ (keep `pnpm-lock.yaml` in sync)
- **Lint/Format**: Oxlint (type-aware) + Oxfmt
- **Tests**: Vitest with V8 coverage (70% thresholds)
- **Build**: tsdown → `dist/`
- **CLI**: Commander + clack/prompts
- **Web UI**: Vite + Lit (legacy decorators) in `ui/`
- **Native Apps**: SwiftUI (macOS/iOS), Kotlin (Android) in `apps/`

## Essential Commands

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `pnpm install`       | Install dependencies                                  |
| `pnpm build`         | Full build (TypeScript + UI + protocol)               |
| `pnpm tsgo`          | Type-check only (no emit)                             |
| `pnpm check`         | Lint + format check + type-check (run before commits) |
| `pnpm lint`          | Oxlint (type-aware)                                   |
| `pnpm lint:fix`      | Auto-fix lint + format                                |
| `pnpm format`        | Oxfmt write                                           |
| `pnpm format:check`  | Oxfmt check                                           |
| `pnpm test`          | Run all unit tests                                    |
| `pnpm test:fast`     | Unit tests only (faster)                              |
| `pnpm test:watch`    | Vitest watch mode                                     |
| `pnpm test:e2e`      | End-to-end tests                                      |
| `pnpm test:coverage` | Coverage report                                       |
| `pnpm openclaw ...`  | Run CLI from source                                   |
| `pnpm gateway:dev`   | Start gateway (dev profile, skip channels)            |
| `pnpm ui:dev`        | Start Vite dev server for Control UI                  |

Run a single test file: `pnpm vitest run src/path/to/file.test.ts`

Live tests (real API keys): `CLAWDBOT_LIVE_TEST=1 pnpm test:live` or `LIVE=1 pnpm test:live`

## Architecture

### Core Source (`src/`)

- **`cli/`** — CLI wiring, program builder, dependency injection (`createDefaultDeps`)
- **`commands/`** — Individual CLI command implementations (~197 files)
- **`gateway/`** — HTTP + WebSocket control plane server, auth, RPC methods
- **`agents/`** — Agent runtime, model config, auth profiles, sandbox, tools
- **`channels/`** + **`routing/`** — Channel abstraction layer and message routing
- **`memory/`** — RAG system, embeddings (OpenAI/Gemini/Voyage), SQLite vector search
- **`config/`** — JSON5-based config loading/persistence, Zod validation
- **`plugin-sdk/`** — Public API for channel/skill plugin development
- **`infra/`** — Infrastructure utilities (errors, formatting, etc.)
- **`terminal/`** — Terminal UI: tables (`table.ts`), themes (`theme.ts`), palette (`palette.ts`)
- **`browser/`** — Browser automation (Playwright)
- **`media/`** + **`media-understanding/`** — Media processing and analysis

### Channel Architecture

**Core channels** (in `src/`): Telegram, Discord, Slack, Signal, iMessage, WhatsApp Web, WebChat

**Extension channels** (in `extensions/`): BlueBubbles, Google Chat, Matrix, MS Teams, LINE, Mattermost, Zalo, IRC, Feishu, and more. Each is a workspace package with its own `package.json`.

Always consider **all** built-in + extension channels when refactoring shared logic (routing, allowlists, pairing, command gating, onboarding).

### Plugin System

- **Channel plugins**: Implement `ChannelAdapter` interface, live in `extensions/`
- **Skill plugins**: Custom agent tools, live in `skills/` (~51 plugins)
- **Runtime**: jiti-based dynamic module loading
- **Deps**: Plugin-only deps go in the extension's `package.json`, not root. Avoid `workspace:*` in `dependencies`.

### Monorepo Structure

- **Root**: Core library + CLI
- **`ui/`**: Web Control Panel (Vite + Lit)
- **`packages/`**: Bot frameworks (clawdbot, moltbot)
- **`extensions/`**: Channel plugins (workspace packages)
- **`skills/`**: Skill plugins
- **`apps/`**: Native apps (macOS, iOS, Android)
- **`docs/`**: Mintlify documentation

## Coding Conventions

### Anti-Redundancy (Critical)

- **Never** create duplicate functions. Search for existing implementations first.
- **Never** create re-export wrapper files. Import directly from original source.
- Source of truth locations:
  - Time formatting: `src/infra/format-time`
  - Terminal tables: `src/terminal/table.ts` (`renderTable`)
  - Themes/colors: `src/terminal/theme.ts`
  - CLI progress: `src/cli/progress.ts` (don't hand-roll spinners)
  - Terminal palette: `src/terminal/palette.ts` (no hardcoded colors)

### TypeScript

- Strict mode, avoid `any`
- ESM imports with `.js` extension for cross-package imports
- Type-only imports: `import type { X }`
- Keep files under ~700 LOC; extract helpers when larger

### Testing

- Colocated tests: `*.test.ts` next to source
- E2E tests: `*.e2e.test.ts`
- Live API tests: `*.live.test.ts`
- Coverage thresholds: 70% lines/functions/statements, 55% branches

### Commits

- Use `scripts/committer "<msg>" <file...>` to keep staging scoped
- Concise, action-oriented messages (e.g., `CLI: add verbose flag to send`)
- Group related changes; avoid bundling unrelated refactors

### Naming

- **Product**: "OpenClaw" (capitalized in prose)
- **CLI/binary**: `openclaw` (lowercase in code/commands)
- Version format: `YYYY.M.D` (date-based)

## Tool Schema Guardrails

- Avoid `Type.Union` in tool input schemas (no `anyOf`/`oneOf`/`allOf`)
- Use `stringEnum`/`optionalStringEnum` for string lists
- Use `Type.Optional(...)` instead of `... | null`
- Avoid raw `format` property names in tool schemas

## Control UI (Lit)

Uses **legacy** decorators (not standard `accessor`-based):

```ts
@state() foo = "bar";
@property({ type: Number }) count = 0;
```

Root `tsconfig.json` has `experimentalDecorators: true` with `useDefineForClassFields: false`.

## Docs (Mintlify)

- Internal links: root-relative, no `.md` extension (e.g., `[Config](/configuration)`)
- Anchors: `[Hooks](/configuration#hooks)` — avoid em dashes in headings
- Content must be generic: no personal device names/hostnames
- `docs/zh-CN/**` is auto-generated; do not edit manually

## Multi-Agent Safety

- Do **not** create/apply/drop `git stash` entries unless explicitly requested
- Do **not** switch branches or modify `git worktree` unless explicitly requested
- When committing, scope to your changes only (unless told "commit all")
- Unrecognized files from other agents: leave them alone, focus on your changes

## Docker Operations (OASIS Deployment)

| Command                       | Purpose                |
| ----------------------------- | ---------------------- |
| `scripts/oasis-up.sh`         | `docker compose up -d` |
| `scripts/oasis-up.sh down`    | Stop containers        |
| `scripts/oasis-up.sh logs -f` | Tail logs              |
| `scripts/oasis-up.sh restart` | Restart containers     |

- **`.env`** contains all config and secrets. Passed to containers via `env_file: .env` in `docker-compose.yml`.
- `docker compose up -d` can also be run directly — `oasis-up.sh` is just a convenience wrapper.

## Key Dependencies with Special Rules

- Any dependency with `pnpm.patchedDependencies` must use exact versions (no `^`/`~`)
- Never update the Carbon dependency
- Patching deps (pnpm patches, overrides, vendored changes) requires explicit approval

## Oasis Deployment

### CRITICAL: Resource Management

This machine has 16GB RAM and 4 CPU cores. Before doing heavy work (builds, Claude Code sessions), **pause low-priority containers** to free resources. Unpause when done.

```bash
# Pause (frees ~3GB headroom)
docker pause whisperx audio-listener 2>/dev/null || true

# Unpause
docker unpause whisperx audio-listener 2>/dev/null || true
```

Never stop/restart these — only pause/unpause. Stopping loses loaded model state.

### Infrastructure Map

**Docker containers** (managed via `scripts/oasis-up.sh` / `docker compose`):

| Container         | Service                           | Health Endpoint                    | CPU/Mem Limit | Priority |
| ----------------- | --------------------------------- | ---------------------------------- | ------------- | -------- |
| `oasis`           | OpenClaw gateway                  | `http://localhost:18789/health`    | 2.0 / 3GB     | HIGH     |
| `oasis-dashboard` | Web UI (Express + vanilla JS)     | `http://localhost:3000/api/health` | 0.5 / 512MB   | HIGH     |
| `docker-proxy`    | Docker socket proxy (read-only)   | —                                  | default       | HIGH     |
| `whisperx`        | Audio transcription + diarization | `http://localhost:9000/health`     | 2.0 / 3GB     | LOW      |
| `audio-listener`  | Mic VAD + voice command dispatch  | `http://localhost:9001/health`     | 0.5 / 256MB   | LOW      |
| `oasis-cli`       | CLI (on-demand, `cli` profile)    | —                                  | —             | —        |

**Audio pipeline:** Microphone -> PulseAudio (host) -> audio-listener (VAD) -> ~/oasis-audio/inbox/ -> whisperx (transcribe) -> ~/oasis-audio/done/ -> audio-listener (voice command dispatch) -> gateway hooks API

**Supporting services** (macOS launchd):

| Service                      | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `com.openclaw.oasis`         | Auto-start Docker via `scripts/oasis-up.sh`   |
| `com.openclaw.backup`        | Config backups to Google Drive                |
| `com.oasis.plaud-sync`       | Rsync audio from Google Drive                 |
| `com.oasis.curator-manifest` | Update MANIFEST.md every 2 min                |
| `org.pulseaudio`             | PulseAudio audio bridge for Docker mic access |

**Key paths:**

- Secrets: `.env` (all Docker secrets)
- Logs: `~/.openclaw/logs/`
- Audio inbox: `~/oasis-audio/inbox/` (WAV files from audio-listener)
- Audio transcripts: `~/oasis-audio/done/` (JSON from whisperx)
- Voice profiles: `~/.openclaw/voice-profiles/`
- PulseAudio socket: `/tmp/pulseaudio.socket`

### Secrets Management

- All Docker secrets live in **`.env`** at repo root. No Keychain dependency for containers.
- `scripts/oasis-up.sh` is a clean wrapper around `docker compose` — reads nothing from Keychain.
- `HF_TOKEN` in `.env` enables speaker diarization in WhisperX.

### Agent Team Roster

| Agent                   | Domain                                                                                                             | On-Spawn                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Lead Architect**      | Strategy, orchestration, delegates to specialists                                                                  | Runs `scripts/oasis-health.sh`, reviews report    |
| **Oasis Ops**           | Docker lifecycle (`scripts/oasis-up.sh`), container health, resource limits, launchd services                      | Runs `scripts/oasis-health.sh`, self-heals issues |
| **Frontend Specialist** | `oasis-dashboard` UI/UX and React state management                                                                 | —                                                 |
| **The Sentinel**        | Security auditing (`.env` PII, container caps, port exposure), Dashboard QA                                        | —                                                 |
| **Context Curator**     | Audio pipeline (whisperx, audio-listener containers), diarization accuracy, speaker enrollment, transcript quality | —                                                 |
| **The Archivist**       | Code debt removal, refactoring legacy modules, architectural research                                              | —                                                 |

### Standing Orders (All Agents)

- On spawn, **Oasis Ops** and **Lead Architect** run `scripts/oasis-health.sh` and report findings.
- Security: never commit secrets; `.env` is gitignored; validate no PII leaks into logs.
- Efficiency: monitor container resource usage vs limits in `docker-compose.yml`.
- All secrets for Docker are in `.env` — never add Keychain lookups to Docker workflows.
