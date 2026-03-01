---
name: oasis-sync
description: Analyze git state of the OASIS deployment, produce a diff summary, group changes into logical commits with conventional commit messages, and optionally push. Use when asked to commit changes, sync with upstream, check git status, review what changed, push changes, or clean up the working tree.
metadata: { "openclaw": { "emoji": "🔄", "requires": { "bins": ["git"] } } }
---

# OASIS Git Sync

Analyze the working tree, group changes into logical commits, and synchronize.

## Workflow

### 1. Status Analysis

```bash
cd /Users/oasis/openclaw
git status
git diff --stat
git diff --stat --cached
git log --oneline -5
```

### 2. Upstream Comparison

```bash
git fetch upstream main 2>/dev/null
git rev-list --count HEAD..upstream/main 2>/dev/null   # behind
git rev-list --count upstream/main..HEAD 2>/dev/null   # ahead
```

### 3. Change Grouping

Group uncommitted changes into logical commits by category:

| Category       | File Patterns                                               | Commit Prefix                           |
| -------------- | ----------------------------------------------------------- | --------------------------------------- |
| OASIS infra    | `docker-compose.yml`, `Dockerfile.oasis`, `scripts/oasis-*` | `ops(oasis):`                           |
| Dashboard      | `~/.openclaw/workspace-oasis/dashboard/**`                  | `feat(dashboard):` or `fix(dashboard):` |
| Voice pipeline | `audio-listener/**`, `scripts/voice/**`                     | `feat(voice):` or `fix(voice):`         |
| Skills         | `skills/**`                                                 | `feat(skills):`                         |
| Core code      | `src/**`                                                    | context-dependent                       |
| Docs           | `docs/**`, `*.md` (non-config)                              | `docs:`                                 |
| Config         | `.claude/**`, `AGENTS.md`, `CLAUDE.md`                      | `chore:`                                |
| Scripts        | `scripts/**` (non-oasis)                                    | `chore(scripts):`                       |

### 4. Commit Creation

Use `scripts/committer` when available:

```bash
scripts/committer "<conventional commit message>" <file1> <file2> ...
```

Fallback:

```bash
git add <specific files>
git commit -m "<message>"
```

### 5. Push (only if explicitly requested)

```bash
git push origin main
```

## Report

```
## Sync Report — [date]

### Working Tree State
- Untracked files: X
- Modified files: Y
- Staged files: Z

### Upstream Status
- Behind upstream/main by: N commits
- Ahead of upstream/main by: M commits

### Commits Created
1. `<sha>` <message>
2. `<sha>` <message>

### Files Not Committed (need review)
- [list with reasons]
```

## Safety Rules

- NEVER commit `.env`, credentials, API keys, or real phone numbers.
- NEVER force-push to main.
- NEVER amend existing commits unless explicitly asked.
- Use `scripts/committer` when available to keep staging scoped.
- When in doubt about whether a file should be committed, ask.
- Unrecognized files from other agents: leave untouched, mention in report.
- Dashboard code at `~/.openclaw/workspace-oasis/dashboard/` is outside the repo — it is NOT tracked by git.
