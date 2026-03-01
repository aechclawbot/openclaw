---
name: oasis-cleanup
description: Clean up code debt across the OASIS deployment. Run lint (oxlint), format (oxfmt), typecheck (tsgo), and identify dead code, unused imports, and type errors in both the OpenClaw core repo and OASIS-specific files (docker-compose.yml, Dockerfile.oasis, dashboard code, scripts). Use when asked to clean up, lint, fix formatting, find dead code, resolve type errors, or improve code quality in the OASIS stack.
metadata: { "openclaw": { "emoji": "🧹", "requires": { "bins": ["pnpm"] } } }
---

# OASIS Code Cleanup

Run code quality checks across the full OASIS stack and auto-fix what is safe.

## Workflow

### Phase 1: Core Repo Checks

1. Run format check and auto-fix:

   ```bash
   cd /Users/oasis/openclaw && pnpm format:fix
   ```

2. Run linter:

   ```bash
   pnpm check
   ```

3. Run TypeScript type checking:

   ```bash
   pnpm tsgo
   ```

4. Collect all errors. Categorize as auto-fixable vs manual-review.

### Phase 2: OASIS-Specific File Checks

Check these OASIS-local files that are not part of the upstream repo:

| File                                                                   | Check                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `docker-compose.yml`                                                   | Valid YAML, no deprecated keys, env vars exist in `.env`  |
| `Dockerfile.oasis`                                                     | Valid Dockerfile syntax, base image not stale             |
| `audio-listener/*.py`                                                  | Python syntax (`python3 -m py_compile`)                   |
| `scripts/oasis-*.sh`                                                   | ShellCheck if available (`shellcheck scripts/oasis-*.sh`) |
| `scripts/voice/*.py`                                                   | Python syntax check                                       |
| Dashboard server (`~/.openclaw/workspace-oasis/dashboard/server/*.js`) | Node syntax check                                         |

### Phase 3: Dead Code Detection

1. Check for unused TypeScript exports in `src/` — focus on OASIS-touched files.
2. Cross-reference launchd plists vs scripts they invoke — flag orphans.
3. Cross-reference docker-compose.yml vs scripts/Dockerfiles referenced.

### Phase 4: Report

```
## Cleanup Report — [date]

### Auto-Fixed
- [count] formatting issues (oxfmt)
- [count] lint auto-fixes

### Needs Manual Review
- [list of type errors with file:line]
- [list of lint errors that could not auto-fix]

### OASIS-Specific
- [any docker-compose issues]
- [any ShellCheck findings]
- [any Python syntax errors]

### Dead Code Candidates
- [unused exports]
- [orphaned scripts]
```

## Rules

- Never auto-fix semantic logic — only formatting and obvious lint fixes.
- Run `pnpm format:fix` before `pnpm check` (format first, then lint).
- If `node_modules` is missing, run `pnpm install` first.
- Do not modify files in `node_modules` or `dist/`.
- Dashboard code lives OUTSIDE the repo at `~/.openclaw/workspace-oasis/dashboard/` — it is volume-mounted into Docker.
