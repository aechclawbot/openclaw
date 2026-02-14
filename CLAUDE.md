# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** This is a symlink target. `AGENTS.md` is the primary file; keep both in sync.

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

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm build` | Full build (TypeScript + UI + protocol) |
| `pnpm tsgo` | Type-check only (no emit) |
| `pnpm check` | Lint + format check + type-check (run before commits) |
| `pnpm lint` | Oxlint (type-aware) |
| `pnpm lint:fix` | Auto-fix lint + format |
| `pnpm format` | Oxfmt write |
| `pnpm format:check` | Oxfmt check |
| `pnpm test` | Run all unit tests |
| `pnpm test:fast` | Unit tests only (faster) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | End-to-end tests |
| `pnpm test:coverage` | Coverage report |
| `pnpm openclaw ...` | Run CLI from source |
| `pnpm gateway:dev` | Start gateway (dev profile, skip channels) |
| `pnpm ui:dev` | Start Vite dev server for Control UI |

Run a single test file: `pnpm vitest run src/path/to/file.test.ts`

Live tests (real API keys): `CLAWDBOT_LIVE_TEST=1 pnpm test:live` or `LIVE=1 pnpm test:live`

## Architecture

### Core Source (`src/`)

- **`cli/`** — CLI wiring, program builder, dependency injection (`createDefaultDeps`)
- **`commands/`** — Individual CLI command implementations (~194 files)
- **`gateway/`** — HTTP + WebSocket control plane server, auth, RPC methods
- **`agents/`** — Agent runtime, model config, auth profiles, sandbox, tools
- **`channels/`** + **`routing/`** — Channel abstraction layer and message routing
- **`memory/`** — RAG system, embeddings (OpenAI/Gemini/Voyage), SQLite vector search
- **`config/`** — YAML-based config loading/persistence, Zod validation
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
- **Skill plugins**: Custom agent tools, live in `skills/` (~53 plugins)
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

## Key Dependencies with Special Rules

- Any dependency with `pnpm.patchedDependencies` must use exact versions (no `^`/`~`)
- Never update the Carbon dependency
- Patching deps (pnpm patches, overrides, vendored changes) requires explicit approval
