# OASIS Dashboard — Full QA, Cleanup & Technical Debt Removal

You are performing a comprehensive QA audit, cleanup plan, and full execution of fixes for the OASIS Dashboard — serving as the control UI for an OpenClaw-based multi-agent system. The site runs at http://oasis.local:3000/ on a Mac Mini 2018 (Intel, 16GB RAM) via Docker.

This is a THREE-PHASE operation. Complete every step of every phase before moving to the next. Do not skip anything. Document everything. All review should focus on v3 of the site, removing any remaining v2 files in the cleanup.

═══════════════════════════════════════════════════════════════
CONTEXT WINDOW MANAGEMENT — CRITICAL
═══════════════════════════════════════════════════════════════

This task will consume a LOT of context. To prevent degraded performance, hallucinations, or lost instructions as the context window fills up, you MUST proactively manage it using /compact at the checkpoints defined below.

### How /compact works:

- /compact summarizes the conversation history to free up context space while preserving key information.
- You MUST write all findings, plans, and progress to FILES (QA-REPORT.md, CLEANUP-PLAN.md, CLEANUP-RESULTS.md) BEFORE running /compact, because conversation content will be summarized and details may be lost.
- After /compact, re-read the relevant file(s) to re-orient yourself before continuing.

### Mandatory /compact Checkpoints:

**COMPACT CHECKPOINT 1** — After completing Phase 1, Sections 1.1 through 1.4.

- Before compacting: Ensure all findings from sections 1.1–1.4 are written to QA-REPORT.md.
- Run: /compact
- After compacting: Re-read QA-REPORT.md to confirm your findings are preserved, then continue with Section 1.5.

**COMPACT CHECKPOINT 2** — After completing Phase 1, Sections 1.5 through 1.8.

- Before compacting: Ensure all findings from sections 1.5–1.8 are appended to QA-REPORT.md.
- Run: /compact
- After compacting: Re-read QA-REPORT.md, then continue with Section 1.9.

**COMPACT CHECKPOINT 3** — After completing Phase 1 entirely (Sections 1.9–1.11).

- Before compacting: Ensure ALL Phase 1 findings are finalized in QA-REPORT.md. Review the file end-to-end for completeness.
- Run: /compact
- After compacting: Re-read QA-REPORT.md fully, then begin Phase 2.

**COMPACT CHECKPOINT 4** — After completing Phase 2 entirely.

- Before compacting: Ensure CLEANUP-PLAN.md is complete with all categorized issues, fix order, specific instructions, and scope estimates.
- Run: /compact
- After compacting: Re-read CLEANUP-PLAN.md fully, then begin Phase 3.

**COMPACT CHECKPOINT 5** — After completing Phase 3 fix categories 1–8 (Security through State Management).

- Before compacting: Ensure all changes are committed to git. Update CLEANUP-RESULTS.md with progress so far (what's been fixed, current build status).
- Run: /compact
- After compacting: Re-read CLEANUP-PLAN.md (to see remaining work) and CLEANUP-RESULTS.md (to see progress), then continue with category 9.

**COMPACT CHECKPOINT 6** — After completing Phase 3 fix categories 9–12 (Component Refactoring through Accessibility).

- Before compacting: Commit all changes. Update CLEANUP-RESULTS.md with progress.
- Run: /compact
- After compacting: Re-read CLEANUP-PLAN.md and CLEANUP-RESULTS.md, then continue with category 13.

**EMERGENCY COMPACT** — If at ANY point you notice:

- Your responses are getting shorter or less detailed than they should be
- You're starting to forget instructions or repeat yourself
- You're losing track of what you've already done
- You feel like context is getting tight
  Then IMMEDIATELY: write all current progress to the appropriate file(s), run /compact, re-read the files, and continue.

### The Golden Rule:

NEVER /compact without first writing your state to disk. ALWAYS re-read files after /compact.

═══════════════════════════════════════════════════════════════
PHASE 1: EXHAUSTIVE QA AUDIT
═══════════════════════════════════════════════════════════════

Before touching any code, perform a complete audit. Write all findings to a file called QA-REPORT.md in the project root. Organize findings by severity: CRITICAL > HIGH > MEDIUM > LOW > INFO.

IMPORTANT: Write findings to QA-REPORT.md incrementally as you complete each section. Do NOT hold findings in memory — write them to the file immediately. This protects your work across /compact checkpoints and prevents context overflow.

## 1.1 — PROJECT DISCOVERY & INVENTORY

First, understand everything about the project:

- Read the entire project structure. Run `find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.git/*' | head -500` and examine the full tree.
- Read package.json completely — note every dependency, script, and config.
- Read next.config.js / next.config.mjs and all config files (tsconfig, eslint, tailwind, postcss, etc.).
- Read CLAUDE.md if it exists for project-specific context.
- Read docker-compose.yml and any Dockerfile(s).
- Read .env / .env.local / .env.example files (note any missing or misconfigured vars).
- Catalog every page route, API route, and middleware file.
- Create a complete inventory list in QA-REPORT.md with:
  - All pages/routes and their purpose
  - All API endpoints and their purpose
  - All components and their usage
  - All utility/helper files
  - All config files
  - All static assets

## 1.2 — PAGE-BY-PAGE FUNCTIONAL TESTING

For EVERY page in the application, verify the following. Visit each route conceptually by reading the code thoroughly:

### For each page:

- [ ] Does the page render without errors? Check for missing imports, undefined variables, incorrect prop types.
- [ ] Does the page handle loading states correctly? Is there a spinner/skeleton while data fetches?
- [ ] Does the page handle error states? What happens when an API call fails?
- [ ] Does the page handle empty states? What shows when there's no data?
- [ ] Are all links/buttons functional? Do they navigate to correct destinations?
- [ ] Are all forms validated properly? Client-side and server-side?
- [ ] Is the page accessible? (ARIA labels, keyboard navigation, screen reader support, color contrast)
- [ ] Does the page handle authentication/authorization if required?
- [ ] Are there any hardcoded values that should be dynamic or configurable?
- [ ] Does the page clean up after itself? (useEffect cleanup, event listener removal, interval clearing)

**Write all page findings to QA-REPORT.md now before continuing.**

## 1.3 — API ENDPOINT TESTING

For EVERY API route in the application:

- [ ] Read the handler code completely.
- [ ] Verify HTTP method handling (does it reject wrong methods?).
- [ ] Verify input validation (are query params, body, headers validated?).
- [ ] Verify error handling (try/catch around external calls, proper error responses).
- [ ] Verify response format consistency (always JSON? correct status codes?).
- [ ] Check for missing authentication/authorization checks.
- [ ] Check for SQL injection, XSS, or other security vulnerabilities.
- [ ] Check for rate limiting where appropriate.
- [ ] Check for proper CORS configuration.
- [ ] Verify that API routes handle timeout scenarios from upstream services.
- [ ] Check if there are any API routes that are defined but never called (dead endpoints).

**Write all API findings to QA-REPORT.md now before continuing.**

## 1.4 — COMPONENT-LEVEL ANALYSIS

For EVERY React component:

- [ ] Check for proper TypeScript types/interfaces (or PropTypes if JS). Flag any `any` types.
- [ ] Check for missing or incorrect key props in lists/maps.
- [ ] Check for proper memo/useMemo/useCallback usage where performance matters.
- [ ] Check for memory leaks (unsubscribed listeners, uncancelled fetches, orphaned intervals/timeouts).
- [ ] Check for proper conditional rendering (no && with numbers that could be 0).
- [ ] Check for accessibility issues (missing alt text, missing labels, non-semantic HTML).
- [ ] Check for inline styles that should be in CSS/Tailwind classes.
- [ ] Check for duplicated logic that should be extracted to hooks or utilities.
- [ ] Check for components that are too large and should be split.
- [ ] Check for unused props being passed down.
- [ ] Check for prop drilling that should use context or state management.

**Write all component findings to QA-REPORT.md now.**

╔═══════════════════════════════════════════════════════════╗
║ 🔄 COMPACT CHECKPOINT 1 ║
║ 1. Verify QA-REPORT.md has all findings from 1.1–1.4 ║
║ 2. Run: /compact ║
║ 3. After compact: re-read QA-REPORT.md ║
║ 4. Continue with Section 1.5 ║
╚═══════════════════════════════════════════════════════════╝

## 1.5 — STYLING & UI CONSISTENCY AUDIT

- [ ] Check Tailwind config for unused custom values or missing design tokens.
- [ ] Check for inconsistent spacing, padding, margins across similar components.
- [ ] Check for inconsistent color usage (hardcoded hex vs. theme variables).
- [ ] Check for inconsistent typography (font sizes, weights, line heights).
- [ ] Check for inconsistent border radius, shadows, and other decorative properties.
- [ ] Check dark/light mode implementation — does every component respect the theme?
- [ ] Check responsive design — are there breakpoint-specific issues? Missing mobile styles?
- [ ] Check for z-index conflicts or stacking context issues.
- [ ] Check for overflow issues (text truncation, container overflow).
- [ ] Check for inconsistent hover/focus/active states.
- [ ] Check for missing transitions/animations where they'd improve UX.
- [ ] Check for CSS/Tailwind classes that are defined but never used.

## 1.6 — STATE MANAGEMENT & DATA FLOW

- [ ] Map out all state management (useState, useReducer, Context, Zustand, Redux, SWR, React Query, etc.).
- [ ] Identify state that is duplicated across components.
- [ ] Identify stale state issues (data fetched once but never refreshed).
- [ ] Check auto-refresh mechanisms — are intervals properly set and cleaned up?
- [ ] Check for race conditions in async operations.
- [ ] Check for proper optimistic updates where applicable.
- [ ] Check cache invalidation strategies.
- [ ] Verify that real-time data (WebSocket, polling) handles disconnection/reconnection gracefully.

## 1.7 — DEPENDENCY & SECURITY AUDIT

- Run `npm audit` (or yarn/pnpm equivalent) and record ALL vulnerabilities.
- Run `npx depcheck` to find unused dependencies.
- Check for outdated dependencies: `npm outdated`.
- Check for dependencies with known security issues.
- Check for dependencies that are unmaintained (no updates in 2+ years).
- Check for duplicate dependencies (different versions of the same package).
- Check for dependencies that could be replaced with lighter alternatives.
- Check package-lock.json / yarn.lock integrity.
- Verify all devDependencies are correctly categorized (not in dependencies).
- Check for any dependencies imported but never used in code.

## 1.8 — BUILD & CONFIGURATION AUDIT

- [ ] Run `npm run build` (or equivalent) and capture ALL warnings and errors.
- [ ] Check TypeScript strict mode compliance — run `npx tsc --noEmit` and record all type errors.
- [ ] Run ESLint: `npx eslint . --ext .ts,.tsx,.js,.jsx` and capture all warnings/errors.
- [ ] Check for missing or misconfigured environment variables across environments.
- [ ] Verify next.config settings are optimal (image optimization, headers, rewrites, redirects).
- [ ] Check Dockerfile for best practices (multi-stage builds, layer caching, security).
- [ ] Check docker-compose.yml for resource limits, health checks, restart policies.
- [ ] Verify .gitignore covers all generated/sensitive files.
- [ ] Check for any secrets or API keys committed to the repo.

**Write all findings from 1.5–1.8 to QA-REPORT.md now.**

╔═══════════════════════════════════════════════════════════╗
║ 🔄 COMPACT CHECKPOINT 2 ║
║ 1. Verify QA-REPORT.md has all findings from 1.5–1.8 ║
║ 2. Run: /compact ║
║ 3. After compact: re-read QA-REPORT.md ║
║ 4. Continue with Section 1.9 ║
╚═══════════════════════════════════════════════════════════╝

## 1.9 — PERFORMANCE AUDIT

- [ ] Identify components that re-render unnecessarily (missing React.memo, missing dependency arrays).
- [ ] Check for large bundle imports that could be lazy-loaded or code-split.
- [ ] Check for images without optimization (next/image usage, proper sizing, formats).
- [ ] Check for N+1 data fetching patterns (fetching in loops, waterfalls instead of parallel).
- [ ] Check for missing Suspense boundaries and streaming where applicable.
- [ ] Check for fonts loaded inefficiently (not using next/font).
- [ ] Identify any synchronous operations that block the UI.
- [ ] Check for excessive DOM nodes in any single page.

## 1.10 — CODE QUALITY & TECHNICAL DEBT

- [ ] Find all TODO, FIXME, HACK, XXX, TEMP, WORKAROUND comments. List each one with file and line number.
  - Run: `grep -rn "TODO\|FIXME\|HACK\|XXX\|TEMP\|WORKAROUND" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" .`
- [ ] Find dead code: unused functions, unreachable code paths, commented-out blocks.
  - Run: `grep -rn "^[[:space:]]*//" --include="*.ts" --include="*.tsx" . | head -100` to find commented-out code.
- [ ] Find copy-pasted code that should be abstracted.
- [ ] Find overly complex functions (>50 lines, deeply nested logic, high cyclomatic complexity).
- [ ] Find inconsistent naming conventions (camelCase vs snake_case vs PascalCase misuse).
- [ ] Find files with mixed concerns (API calls mixed with rendering, business logic in components).
- [ ] Find missing or outdated documentation/comments.
- [ ] Find inconsistent error handling patterns across the codebase.
- [ ] Find magic numbers and strings that should be constants.
- [ ] Find any console.log/console.error statements that should be removed or replaced with proper logging.
  - Run: `grep -rn "console\.\(log\|warn\|error\|debug\|info\)" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" .`
- [ ] Check for consistent file/folder organization patterns.

## 1.11 — CROSS-CUTTING CONCERNS

- [ ] Error boundary implementation — is there a global error boundary? Per-section boundaries?
- [ ] Loading/skeleton strategy — is it consistent across the app?
- [ ] Notification/toast system — is it unified or scattered?
- [ ] Navigation — is the nav structure consistent? Are breadcrumbs implemented where needed?
- [ ] Search functionality — does it work correctly across all searchable areas?
- [ ] Keyboard shortcuts — are they documented and functional?
- [ ] Auto-refresh — is the 30s refresh working correctly everywhere? Visual indicator?
- [ ] WebSocket/real-time connections — properly managed lifecycle?

**Write all findings from 1.9–1.11 to QA-REPORT.md now. Review the entire QA-REPORT.md for completeness.**

╔═══════════════════════════════════════════════════════════╗
║ 🔄 COMPACT CHECKPOINT 3 ║
║ 1. Verify QA-REPORT.md is COMPLETE for all of Phase 1 ║
║ 2. Run: /compact ║
║ 3. After compact: re-read QA-REPORT.md fully ║
║ 4. Begin Phase 2 ║
╚═══════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════
PHASE 2: CLEANUP PLAN
═══════════════════════════════════════════════════════════════

Re-read QA-REPORT.md in its entirety before starting this phase. Create a file called CLEANUP-PLAN.md in the project root. This is your execution blueprint.

## 2.1 — Categorize Every Finding

Take every issue from QA-REPORT.md and categorize it:

### Priority Tiers:

- **P0 — CRITICAL**: Broken functionality, security vulnerabilities, data loss risks, crashes. Fix immediately.
- **P1 — HIGH**: Significant bugs, missing error handling, accessibility violations, performance blockers. Fix in this session.
- **P2 — MEDIUM**: UI inconsistencies, code quality issues, missing validations, technical debt. Fix in this session.
- **P3 — LOW**: Minor polish, style inconsistencies, nice-to-haves. Fix if time allows.
- **P4 — INFO**: Observations, future improvement suggestions. Document but don't fix now.

### Fix Categories:

- **BUG**: Something that's broken or doesn't work as intended.
- **SECURITY**: Security vulnerability or exposure.
- **PERFORMANCE**: Performance degradation or optimization needed.
- **ACCESSIBILITY**: A11y violation or improvement.
- **CODE-QUALITY**: Refactoring, cleanup, or pattern improvement.
- **TECH-DEBT**: Shortcuts, workarounds, or outdated patterns that need modernizing.
- **DEAD-CODE**: Code that serves no purpose and should be removed.
- **DEPENDENCY**: Package-related issue (outdated, unused, vulnerable).
- **CONFIG**: Configuration issue or improvement.
- **DOCS**: Missing or outdated documentation.
- **UI/UX**: Visual or interaction inconsistency.

## 2.2 — Determine Fix Order

Organize the fixes into an ordered execution plan. The order MUST be:

1. **Security fixes first** — any exposed secrets, vulnerabilities, auth issues.
2. **Critical bugs** — crashes, data loss, broken core functionality.
3. **Dependency cleanup** — remove unused, update vulnerable, fix audit issues.
4. **Dead code removal** — delete all unused files, functions, components, imports, variables.
5. **Configuration fixes** — env vars, build config, TypeScript/ESLint config tightening.
6. **Error handling improvements** — add missing try/catch, error boundaries, fallback UI.
7. **Type safety improvements** — eliminate `any` types, add missing interfaces, fix type errors.
8. **State management cleanup** — fix stale state, race conditions, missing cleanups.
9. **Component refactoring** — split oversized components, extract shared hooks/utilities, fix prop drilling.
10. **API route hardening** — input validation, consistent error responses, proper status codes.
11. **Performance optimizations** — lazy loading, memoization, bundle splitting, image optimization.
12. **Accessibility fixes** — ARIA labels, keyboard nav, semantic HTML, contrast.
13. **UI/UX consistency** — spacing, colors, typography, responsive, dark/light mode.
14. **Code quality polish** — naming conventions, magic numbers, console.logs, file organization.
15. **Documentation updates** — inline comments, README, API docs, CLAUDE.md updates.
16. **TODO/FIXME resolution** — address or remove every TODO and FIXME in the codebase.

## 2.3 — Write Specific Fix Instructions

For EACH fix in the plan, document:

- **File(s) affected**: Exact file paths.
- **Current behavior**: What's happening now.
- **Expected behavior**: What should happen after the fix.
- **Fix description**: Exactly what code changes are needed.
- **Risk assessment**: Could this fix break anything else? What to verify after.
- **Dependencies**: Does this fix depend on another fix being done first?

## 2.4 — Estimate Scope

At the bottom of CLEANUP-PLAN.md, provide:

- Total number of issues found per severity.
- Total number of files that will be modified.
- List of files that will be deleted (dead code).
- List of dependencies that will be added/removed/updated.
- Any breaking changes to expect.
- Rollback strategy if something goes wrong.

**Verify CLEANUP-PLAN.md is complete and covers every issue from QA-REPORT.md.**

╔═══════════════════════════════════════════════════════════╗
║ 🔄 COMPACT CHECKPOINT 4 ║
║ 1. Verify CLEANUP-PLAN.md is fully written ║
║ 2. Run: /compact ║
║ 3. After compact: re-read CLEANUP-PLAN.md fully ║
║ 4. Begin Phase 3 ║
╚═══════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════
PHASE 3: EXECUTE THE COMPLETE CLEANUP
═══════════════════════════════════════════════════════════════

Re-read CLEANUP-PLAN.md in its entirety before starting this phase. Execute every fix in order. After each major fix category, verify the app still builds and runs.

## 3.1 — Pre-Execution Setup

Before making ANY changes:

- Run `git status` to ensure a clean working directory.
- Create a checkpoint: `git add -A && git commit -m "pre-QA-cleanup checkpoint"`.
- Create a branch: `git checkout -b qa-cleanup-$(date +%Y%m%d)`.
- Verify the app builds: `npm run build`.
- Verify the app starts: `npm run dev` (test briefly, then stop).
- Record the current state in CLEANUP-RESULTS.md: number of TypeScript errors, ESLint warnings, npm audit results.
- Initialize CLEANUP-RESULTS.md with a "Before" section capturing these baseline metrics.

## 3.2 — Execute Fixes In Order

Follow the order from Section 2.2. For each category:

1. Re-read the relevant section of CLEANUP-PLAN.md for that category.
2. Make all changes for that category.
3. After completing the category, run:
   - `npx tsc --noEmit` (catch type errors introduced).
   - `npx eslint . --ext .ts,.tsx,.js,.jsx` (catch lint issues introduced).
   - `npm run build` (verify it still compiles).
4. If the build breaks, fix the issue before moving to the next category.
5. Commit after each category with a descriptive message:
   - `git add -A && git commit -m "QA cleanup: [category name] — [summary of changes]"`
6. Update CLEANUP-RESULTS.md with what was just completed.

## 3.3 — Specific Execution Instructions

### Dead Code Removal

- Delete the file/function/variable entirely. Do not comment it out.
- After each deletion, verify no imports are now broken.
- Remove any orphaned test files for deleted code.
- Remove any orphaned CSS/style files for deleted components.

### Dependency Cleanup

- Remove unused deps: `npm uninstall <package>`.
- Update vulnerable deps one at a time, testing build after each.
- If a major version update is needed and risky, document it in a FUTURE-UPGRADES.md file instead of doing it now.
- Run `npm audit fix` only AFTER manual removals/updates.
- Delete and regenerate lockfile if it's corrupted: `rm package-lock.json && npm install`.

### Component Refactoring

- When extracting shared hooks, place them in a `/hooks` directory.
- When extracting shared utilities, place them in a `/utils` or `/lib` directory.
- When splitting large components, keep them co-located in the same directory.
- Update all import paths after moves.
- Preserve git history where possible (use `git mv` for renames).

### TypeScript Hardening

- Replace every `any` with a proper type. If the correct type is complex, create an interface in a `types/` directory.
- Add return types to all exported functions.
- Enable strict TypeScript options incrementally if not already enabled:
  - `"strict": true`
  - `"noUncheckedIndexedAccess": true`
  - `"noImplicitReturns": true`
  - `"noFallthroughCasesInSwitch": true`

### Console.log Cleanup

- Remove ALL console.log statements used for debugging.
- Replace meaningful console.error/warn with a proper logging utility if one exists, or create a simple one.
- Keep console.error only in catch blocks where no better logging exists.

### TODO/FIXME Resolution

- For each TODO: either implement the fix now, or convert it to a tracked issue in CLEANUP-RESULTS.md with a reason why it can't be done now.
- For each FIXME: these are bugs — fix them.
- For each HACK/WORKAROUND: implement the proper solution.
- After resolution, the codebase should have ZERO unaddressed TODO/FIXME/HACK comments.

╔═══════════════════════════════════════════════════════════╗
║ 🔄 COMPACT CHECKPOINT 5 ║
║ After completing fix categories 1–8 ║
║ (Security through State Management) ║
║ 1. git add -A && git commit (if uncommitted changes) ║
║ 2. Update CLEANUP-RESULTS.md with progress so far ║
║ 3. Run: /compact ║
║ 4. After compact: re-read CLEANUP-PLAN.md (remaining) ║
║ and CLEANUP-RESULTS.md (progress) ║
║ 5. Continue with category 9 ║
╚═══════════════════════════════════════════════════════════╝

Continue executing categories 9–12 (Component Refactoring, API Route Hardening, Performance Optimizations, Accessibility Fixes).

For each category:

1. Re-read the relevant section of CLEANUP-PLAN.md.
2. Execute all fixes.
3. Run build verification (`tsc`, `eslint`, `npm run build`).
4. Commit with descriptive message.
5. Update CLEANUP-RESULTS.md.

╔═══════════════════════════════════════════════════════════╗
║ 🔄 COMPACT CHECKPOINT 6 ║
║ After completing fix categories 9–12 ║
║ (Component Refactoring through Accessibility) ║
║ 1. git add -A && git commit (if uncommitted changes) ║
║ 2. Update CLEANUP-RESULTS.md with progress so far ║
║ 3. Run: /compact ║
║ 4. After compact: re-read CLEANUP-PLAN.md (remaining) ║
║ and CLEANUP-RESULTS.md (progress) ║
║ 5. Continue with category 13 ║
╚═══════════════════════════════════════════════════════════╝

Continue executing categories 13–16 (UI/UX Consistency, Code Quality Polish, Documentation Updates, TODO/FIXME Resolution).

For each category:

1. Re-read the relevant section of CLEANUP-PLAN.md.
2. Execute all fixes.
3. Run build verification (`tsc`, `eslint`, `npm run build`).
4. Commit with descriptive message.
5. Update CLEANUP-RESULTS.md.

## 3.4 — Post-Execution Verification

After ALL fixes are complete:

1. **Build verification**: `npm run build` — MUST pass with zero errors.
2. **Type checking**: `npx tsc --noEmit` — record remaining errors (should be fewer than before).
3. **Lint check**: `npx eslint . --ext .ts,.tsx,.js,.jsx` — record remaining warnings.
4. **Security audit**: `npm audit` — record remaining vulnerabilities.
5. **Dependency check**: `npx depcheck` — should show no unused dependencies.
6. **Start the dev server**: `npm run dev` — verify the app loads without console errors.
7. **Smoke test every page**: Navigate to each route and verify it renders.
8. **Verify auto-refresh**: Confirm the 30s refresh still works on the dashboard.
9. **Verify dark/light mode**: Toggle and confirm all pages respect the theme.
10. **Check Docker**: If running in Docker, rebuild the image and verify the container starts correctly.

## 3.5 — Final Report

Finalize CLEANUP-RESULTS.md in the project root with:

- **Before/After metrics**: TypeScript errors, ESLint warnings, npm audit vulnerabilities, unused dependencies, total lines of code, number of files.
- **Summary of all changes made**, organized by category.
- **Files deleted** (dead code removed).
- **Dependencies removed/updated**.
- **Known remaining issues** that couldn't be fixed in this session and why.
- **Recommendations** for future improvements that are out of scope for this cleanup.

## 3.6 — Final Commit

```bash
git add -A
git commit -m "QA cleanup complete — see CLEANUP-RESULTS.md for full summary"
```

Confirm the branch is ready for review or merging.

═══════════════════════════════════════════════════════════════
IMPORTANT RULES
═══════════════════════════════════════════════════════════════

1. **DO NOT skip any step.** Every checkbox above must be addressed.
2. **DO NOT make changes during Phase 1.** Phase 1 is audit only.
3. **DO NOT move to Phase 3 without completing Phase 2.** The plan must exist before execution.
4. **Commit frequently.** After each fix category, not at the end.
5. **If a fix is risky, note it.** Don't silently introduce regressions.
6. **Test the build after every category.** If it breaks, fix it before moving on.
7. **Be aggressive about dead code.** If it's not used, delete it. Don't comment it out.
8. **Be aggressive about technical debt.** TODOs and FIXMEs get resolved, not perpetuated.
9. **Preserve functionality.** The app should work exactly the same (or better) after cleanup. No feature regressions.
10. **Document everything.** The three report files (QA-REPORT.md, CLEANUP-PLAN.md, CLEANUP-RESULTS.md) are deliverables.
11. **ALWAYS write state to files BEFORE running /compact.** Never lose work to context compression.
12. **ALWAYS re-read relevant files AFTER running /compact.** Re-orient before continuing.
13. **Use EMERGENCY /compact proactively** if context feels tight. Don't wait until you're degraded.

═══════════════════════════════════════════════════════════════
COMPACT CHECKPOINT SUMMARY (quick reference)
═══════════════════════════════════════════════════════════════

| Checkpoint | When                           | Write to file first           | Re-read after        |
| ---------- | ------------------------------ | ----------------------------- | -------------------- |
| CP-1       | After Phase 1, §1.1–1.4        | QA-REPORT.md (1.1–1.4)        | QA-REPORT.md         |
| CP-2       | After Phase 1, §1.5–1.8        | QA-REPORT.md (1.5–1.8)        | QA-REPORT.md         |
| CP-3       | After Phase 1 complete         | QA-REPORT.md (final)          | QA-REPORT.md         |
| CP-4       | After Phase 2 complete         | CLEANUP-PLAN.md (final)       | CLEANUP-PLAN.md      |
| CP-5       | After Phase 3, categories 1–8  | CLEANUP-RESULTS.md (progress) | PLAN.md + RESULTS.md |
| CP-6       | After Phase 3, categories 9–12 | CLEANUP-RESULTS.md (progress) | PLAN.md + RESULTS.md |
| EMERGENCY  | Whenever context feels tight   | Current progress to file(s)   | All relevant files   |

Start now. Begin with Phase 1, Section 1.1.
