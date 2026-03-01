Run the OASIS backup verification workflow. Follow the instructions in `oasis/skills/oasis-backup/SKILL.md` exactly.

Steps:

1. Read `oasis/skills/oasis-backup/SKILL.md`
2. Verify nightly backup launchd service is loaded and ran recently
3. Check backup log at `/tmp/openclaw-backup.log`
4. Inventory all critical data (config, workspaces, voice profiles, .env, docker-compose)
5. Check git remote health (origin + upstream reachable)
6. Check Time Machine status if available
7. Verify no uncommitted critical config changes
8. Produce the Backup Report
