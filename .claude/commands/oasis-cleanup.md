Run the OASIS code cleanup workflow. Follow the instructions in `skills/oasis-cleanup/SKILL.md` exactly.

Steps:

1. Read `skills/oasis-cleanup/SKILL.md`
2. Execute Phase 1: `pnpm format:fix`, `pnpm check`, `pnpm tsgo`
3. Execute Phase 2: Check OASIS-specific files (docker-compose.yml, Dockerfile.oasis, scripts, dashboard code)
4. Execute Phase 3: Dead code detection
5. Produce the structured Cleanup Report
