# OASIS Monorepo Reorganization — Planning Task for Claude Code

## Context

OASIS is a multi-agent system running on a Mac Mini 2018 operated by a solo developer. It has three distinct Docker services:

1. **Voice Listener** — Continuous audio capture, transcription (AssemblyAI), and monitoring
2. **OpenClaw** — Multi-agent orchestration system (agents: Aech, The Curator, Art3mis, Ogden Morrow)
3. **Dashboard** — Web UI for managing and monitoring the agents

The codebase lives at `/Users/oasis/openclaw` and is a clone of the OpenClaw repo, which receives frequent upstream updates via `git pull`. The OpenClaw deployment process pushes files into `~/.openclaw/`.

**The core problem:** Our custom files (especially the Dashboard and Voice Listener) are intermingled with stock OpenClaw files. This creates merge conflicts on upstream pulls and risks our custom code getting clobbered or tangled with the OpenClaw deployment that targets `~/.openclaw/`.

**The strategy:** Reorganize IN PLACE on a branch. OpenClaw stays as the repo foundation — stock files stay exactly where upstream expects them. Our custom code (dashboard, voice listener, agents, skills, infra) gets organized into clearly separated directories that won't collide with upstream merges or the `~/.openclaw/` deployment.

**Top priority:** The Dashboard files must be in a completely clean, isolated folder. They are entirely our code and have zero overlap with upstream OpenClaw.

## Your Task

**Do NOT make any changes yet.** This is a PLANNING phase only. Produce a comprehensive reorganization plan as a markdown document.

---

### Step 1: Full Audit of `/Users/oasis/openclaw`

- Recursively scan the entire directory tree
- Catalog every file and folder
- For each file, classify it into one of these buckets:
  - `openclaw-stock` — **Unmodified** upstream OpenClaw files. These must NOT be moved. Note the path upstream expects.
  - `openclaw-modified` — Upstream files we've customized. Flag exactly what was changed and why.
  - `dashboard` — Next.js frontend code. **Entirely ours, no upstream equivalent.**
  - `voice-listener` — Audio/transcription service code. **Entirely ours.**
  - `custom-agents` — Our agent definitions/configs (Aech, Curator, Art3mis, Ogden Morrow). Note whether these use an OpenClaw-provided agent framework or are freestanding.
  - `shared` — Utilities or configs used by 2+ services (note which ones)
  - `infra` — docker-compose, Tailscale, networking, environment orchestration
  - `scripts` — Build scripts, deployment helpers, dev tooling
  - `skills` — Custom Claude Code skills (especially `/oasis-ops`)
  - `obsolete` — Dead code, old experiments, unused files (flag with reasoning)
  - `unknown` — Can't determine ownership (flag for my review)

**Critical classification work:**

- Check the upstream OpenClaw repo to confirm which files are stock vs. ours. Don't guess — compare against the actual upstream if accessible, or use git blame/log to determine origin.
- Identify every file that the `~/.openclaw/` deployment process touches or expects. These paths are sacred and must not be disrupted.
- Map which of our files currently live INSIDE directories that OpenClaw owns. These are the ones most at risk during upstream pulls.

Output as a complete table: `| File Path | Classification | Upstream Equivalent? | Deployment Risk | Proposed New Location | Notes |`

### Step 2: Dependency & Coupling Map

- For each of the 3 services, trace all internal imports and file references
- Map shared utilities, configs, environment variables, and secrets
- Document inter-service communication patterns (API calls, shared Docker volumes, network calls)
- List all external dependencies per service
- Flag any tight coupling between our custom code and OpenClaw internals

**Upstream conflict analysis:**

- Which of our files have previously caused merge conflicts on `git pull`?
- Which directories does upstream actively develop in? (These are high-risk zones for our files.)
- Are any of our import paths or configs sensitive to upstream directory restructuring?

### Step 3: Target Structure

Design the reorganized structure. The guiding principles are:

1. **Stock OpenClaw files stay put.** Don't move anything upstream expects to find in a specific location.
2. **Our code lives in clearly separated top-level directories** that upstream will never touch (because they don't exist in the upstream repo).
3. **Dashboard gets the cleanest isolation** — completely self-contained folder, no dependencies on OpenClaw file locations.
4. **`.gitignore` upstream's deployment artifacts** if `~/.openclaw/` or any build outputs land inside the repo.

Proposed structure (adapt based on audit findings):

```
/Users/oasis/openclaw/
│
├── [all stock openclaw files/folders in their original locations]
│   # DO NOT MOVE THESE — upstream git pull must work cleanly
│
├── oasis/                          # ← ALL of our custom code lives under this namespace
│   │
│   ├── dashboard/                  # ★ TOP PRIORITY — completely isolated
│   │   ├── src/
│   │   ├── public/
│   │   ├── components/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── next.config.js
│   │   ├── .env.example
│   │   └── README.md
│   │
│   ├── voice-listener/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── .env.example
│   │   ├── config/
│   │   └── README.md
│   │
│   ├── agents/                     # Our custom agent definitions
│   │   ├── aech/
│   │   ├── curator/
│   │   ├── art3mis/
│   │   ├── ogden-morrow/
│   │   └── README.md
│   │
│   ├── shared/                     # Shared utilities across our services
│   │   ├── utils/
│   │   ├── types/
│   │   └── config/
│   │
│   ├── infra/
│   │   ├── docker-compose.yml      # Master compose for all 3 services
│   │   ├── docker-compose.dev.yml
│   │   ├── networking/
│   │   └── env/
│   │
│   ├── scripts/
│   │   ├── start-all.sh
│   │   ├── health-check.sh
│   │   └── ...
│   │
│   └── skills/
│       ├── oasis-ops/
│       └── README.md
│
├── docs/
│   ├── architecture.md
│   ├── setup-guide.md
│   └── upstream-sync.md
│
├── CLAUDE.md                       # Updated project spec
├── .gitignore                      # Must exclude ~/.openclaw/ artifacts if relevant
└── README.md
```

**Why `oasis/` as a single namespace:** One top-level directory that upstream will never create gives us a clean merge boundary. `git pull` from upstream will never touch anything inside `oasis/`. If upstream ever adds an `oasis/` directory (extremely unlikely), we'd see the conflict immediately and handle it.

**Adapt this based on the audit.** If some of our custom code MUST live in specific OpenClaw directories (e.g., agent configs that OpenClaw loads from a fixed path), document those exceptions and explain the trade-off.

### Step 4: Migration Plan

Ordered, mechanical checklist for execution:

1. **Pre-migration**
   - Verify all 3 services currently build and run
   - `git checkout -b reorg/oasis-cleanup` — do all work on a branch
   - `git pull` to ensure we're current with upstream
   - Document current Docker volume mounts, port mappings, Tailscale endpoints
   - Snapshot current working state so we can diff against it after reorg

2. **Create target directory skeleton**
   - All `mkdir -p` commands for the `oasis/` subdirectories

3. **Dashboard migration (DO THIS FIRST)**
   - `git mv` every dashboard file into `oasis/dashboard/`
   - This is the highest-value, lowest-risk move since dashboard files are entirely ours
   - Update all import paths within the dashboard
   - Update Dockerfile COPY paths
   - Update docker-compose build context and volume mounts
   - **Validate:** Dashboard builds and runs from `oasis/dashboard/` before proceeding

4. **Voice Listener migration**
   - `git mv` voice listener files into `oasis/voice-listener/`
   - Same fixup process as dashboard
   - **Validate:** Voice listener builds and runs

5. **Custom agents migration**
   - `git mv` agent files into `oasis/agents/`
   - **Careful:** If OpenClaw loads agents from a specific path, we may need symlinks or config changes to point at the new location. Document this.
   - **Validate:** Agents initialize correctly

6. **Shared, infra, scripts, skills migration**
   - Move remaining custom files into their `oasis/` locations
   - Update all internal cross-references

7. **Handle `openclaw-modified` files**
   - For each upstream file we've modified, decide:
     - **Option A:** Keep our version in place, accept it'll conflict on future pulls (document the customization clearly with comments)
     - **Option B:** Move our customization into `oasis/` as an override/patch, restore the stock file (preferred if possible)
     - **Option C:** Submit our change upstream as a PR (if it's generally useful)
   - Document the decision for each modified file

8. **Cleanup**
   - Delete files classified as `obsolete`
   - Remove now-empty directories
   - Update `.gitignore` for the new structure
   - Verify `git status` is clean

9. **Validation — full stack**
   - Each service builds independently
   - `docker-compose up` launches everything
   - Dashboard connects to OpenClaw
   - Voice Listener transcribes
   - Agents initialize
   - Inter-service communication works
   - `git pull origin main` (or upstream remote) completes WITHOUT conflicts touching `oasis/`

### Step 5: Risk Assessment

- Flag anything that could break during the reorg
- Identify files that MUST stay in OpenClaw-expected paths (agents, configs, plugins)
- Call out Docker volume mounts or bind mounts with absolute paths
- Note any cron jobs, launchd agents, or systemd services referencing current paths
- Identify which upstream directories are most actively developed (highest merge conflict risk)
- Assess whether the `oasis/` namespace creates any issues with OpenClaw's file discovery or plugin loading
- Recommend the safest migration order (dashboard first is almost certainly right, but confirm)

### Step 6: Upstream Sync Verification

After reorg, verify and document the ongoing upstream workflow:

- `git pull` from upstream applies cleanly without touching `oasis/`
- Document what to do if upstream restructures directories our code depends on
- For `openclaw-modified` files: document the conflict resolution strategy for each one
- Write `docs/upstream-sync.md` with the step-by-step process
- Note the current upstream commit hash we're based on

### Step 7: Skills Update Plan

Audit and update ALL custom Claude Code skills for the new structure:

- Catalog every skill in the current setup (especially `oasis-ops`)
- For each skill, list:
  - Every hardcoded path referencing the old intermingled structure
  - Every assumption about file locations
  - The updated paths under `oasis/`
- Write the complete updated versions of each skill file
- Recommend new skills if the reorganized structure enables them
- Ensure skills know:
  - Dashboard code is at `oasis/dashboard/`
  - Voice listener is at `oasis/voice-listener/`
  - Agents are at `oasis/agents/`
  - Stock OpenClaw files are NOT to be modified without documenting the change

### Step 8: CLAUDE.md Specification

Generate a comprehensive, up-to-date `CLAUDE.md` for the reorganized repo:

- **Project overview** — OASIS system, 3 services, how they interact
- **Repo structure** — explain the dual nature: upstream OpenClaw at root + our code in `oasis/`
- **Directory guide** — complete tree with descriptions. Clearly distinguish "upstream — don't modify" vs "ours — safe to edit"
- **Service architecture** — each service, entry points, dependencies, communication patterns
- **Agent inventory** — each agent's role, config location, modification guide
- **Development workflow** — starting services, dev mode, testing
- **Docker setup** — compose files, build commands, environment variables
- **Environment variables** — complete inventory across all services
- **Upstream sync rules** — brief reference (link to docs/upstream-sync.md)
  - How to pull updates
  - What NOT to modify in upstream directories
  - How modified upstream files are tracked
- **Skills reference** — available skills, when to use each
- **Key conventions** — coding standards, where new code goes, naming patterns
- **Common tasks** — quick reference for frequent operations

**CLAUDE.md must make it unmistakably clear:**

1. Stock OpenClaw files live at the repo root — don't reorganize or move them
2. All OASIS custom code lives under `oasis/` — this is where you work
3. The dashboard is at `oasis/dashboard/` — it's self-contained
4. Modified upstream files are documented exceptions with a clear rationale

---

## Output Format

Single comprehensive markdown document with all 8 steps. Use tables and code blocks. Be exhaustive and mechanical — a follow-up Claude Code session should be able to execute the entire migration by reading only this plan.

**TL;DR summary at the end:**

- Total file count per classification bucket
- Count of stock vs. modified vs. entirely-ours files
- Percentage of files classified as `obsolete`
- Number of skills needing updates
- Number of files currently inside OpenClaw directories that need to move into `oasis/`
- Estimated complexity: low/medium/high
- Top 3 risks
- Confirmed: `git pull` from upstream won't touch `oasis/`
