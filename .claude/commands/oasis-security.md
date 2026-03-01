Run the OASIS security audit. Follow the instructions in `oasis/skills/oasis-security/SKILL.md` exactly.

Steps:

1. Read `oasis/skills/oasis-security/SKILL.md`
2. Scan tracked files for exposed secrets (never print actual values — mask them)
3. Verify Docker security (no privileged, socket proxy restrictions, resource limits)
4. Test API authentication (dashboard rejects unauthed, gateway requires token)
5. Check file permissions on sensitive directories
6. Check network exposure (ports on non-loopback interfaces)
7. Run `pnpm audit` for dependency vulnerabilities
8. Produce the Security Audit Report
