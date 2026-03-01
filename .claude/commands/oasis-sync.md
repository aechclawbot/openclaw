Run the OASIS git sync workflow. Follow the instructions in `oasis/skills/oasis-sync/SKILL.md` exactly.

Steps:

1. Read `oasis/skills/oasis-sync/SKILL.md`
2. Analyze working tree: `git status`, `git diff --stat`
3. Compare against upstream: `git fetch upstream main`, count behind/ahead
4. Group changes into logical commits by category (ops, dashboard, voice, skills, core, docs, config)
5. Create commits using `scripts/committer` or `git add + git commit`
6. NEVER commit .env, credentials, or secrets
7. NEVER push unless explicitly asked
8. Produce the Sync Report
