# OASIS Dashboard — Cleanup Results

**Date:** 2026-02-28
**Based on:** CLEANUP-PLAN.md (75 findings, 11 fix categories)

---

## Baseline Metrics (Before Cleanup)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Total JS files | 64 | 64 | -1 deleted, +1 created |
| Total JS LOC | 36,320 | 35,971 | -349 |
| server.js LOC | 1,673 | 1,700 | +27 (new imports, HMAC, cleanup timer) |
| Dead HTML removed | 0 | 3,583 | index.v2.html deleted |
| npm audit vulnerabilities | 0 | 0 | no change |
| console.log/warn/error calls | 67 | 67 | (deferred to future session) |
| --dangerously-skip-permissions | 12 calls | 0 | eliminated |
| Memory leak fixes | 0 | 5 | timers, caches, subscriptions |
| Security findings fixed | 0 | 10 | |
| Bug fixes | 0 | 12 | |

---

## Execution Progress

### Category 1: Security Fixes — DONE (8/8)

| Fix | Finding | Status |
|-----|---------|--------|
| 1.1 | SC-01, SH-04: Hardcoded credentials | FIXED — auth.js and health.js now default to "" (disabled with warning) |
| 1.2 | SC-02: Command injection in spawn prompts | FIXED — Created `server/utils/sanitize.js` with `sanitizePromptInput()`. Applied to executeTask, plan, and generate-tasks |
| 1.3 | SC-03: --dangerously-skip-permissions | FIXED — Removed from all spawn calls (12 total) across server.js, todos.js, features.js, ops.js, audit.js |
| 1.4 | SM-02: Unused rate-limit and security-headers | FIXED — Both middleware now imported and applied via `app.use()` |
| 1.5 | SH-05: Gemini API key in URL | FIXED — Moved to `x-goog-api-key` header in server.js and curator.js |
| 1.6 | SM-04: Docker logs `since` unsanitized | FIXED — Applied `sanitizeDockerParam()` |
| 1.7 | SM-09: Audit findings unsanitized | FIXED — Applied `sanitizePromptInput()` to title and description |
| 1.8 | SM-01: Timing-unsafe inline auth | FIXED — Replaced with HMAC-based `safeCompare()` (matches modular auth.js pattern) |

### Category 2: Critical Bug Fixes — DONE (1/1)

| Fix | Finding | Status |
|-----|---------|--------|
| 2.1 | FC-03, FC-04: oasis-app error display | FIXED — `_loadError` added to reactive properties, catch sets error instead of unused `_stubPage` |

### Category 3: Route Architecture — DEFERRED

Full route migration (mounting 18 dead modular routes, removing ~1150 LOC inline) is the highest-risk change. Security fixes already applied to modular routes preventively. Full migration requires endpoint-by-endpoint testing — deferred to dedicated session.

### Category 4: Dead Code Removal — DONE (3/3)

| Fix | Finding | Status |
|-----|---------|--------|
| 4.1 | FI-01: index.v2.html (3,583 LOC) | DELETED |
| 4.2 | FC-01: page-agent-detail.js (420 LOC) | DELETED |
| 4.3 | FM-08: _createPageElement() dead method | DELETED from oasis-app.js |

### Category 5: Error Handling — DONE (3/4)

| Fix | Finding | Status |
|-----|---------|--------|
| 5.1 | FH-06: oasis-confirm Enter always confirms | FIXED — Checks if cancel button is focused first |
| 5.2 | FM-01: oasis-toast setTimeout not cleared | FIXED — Timers tracked in Set, cleared in disconnectedCallback |
| 5.3 | SL-08: Chat SSE missing req.close cleanup | DEFERRED — In dead modular route (chat.js); will be addressed with route migration |
| 5.4 | SL-09: Cron catch references outer err | FIXED — Inner catch now uses `readErr` variable |

### Category 6: Component Refactoring — PARTIAL (4/10)

| Fix | Finding | Status |
|-----|---------|--------|
| 6.5 | FM-02, FM-03: Modal/confirm keydown always active | FIXED — Listeners added on open, removed on close |
| 6.7 | FM-06: Hash-prefixed router.navigate() | FIXED — Removed `#` prefix in page-agents.js |
| 6.8 | FM-09: oasis-table cursor ternary | FIXED — Now returns 'pointer' when clickable |
| 6.4 | FH-05: Duplicate static styles | NOT FOUND — Only one instance exists |
| 6.1-6.3, 6.6, 6.9-6.10 | Utility extraction, alert→toast, etc. | DEFERRED — Large refactor for dedicated session |

### Category 7: State Management — DONE (5/5)

| Fix | Finding | Status |
|-----|---------|--------|
| 7.1 | FH-04: Sidebar route subscription leak | FIXED — Stores and calls unsub from router.onChange() |
| 7.2 | SM-03: prevSessionState/prevCronState unbounded | FIXED — Periodic cleanup every 10min, prunes >24h entries |
| 7.3 | SM-07: txHistory cache unbounded | FIXED — Same periodic cleanup interval |
| 7.4 | FL-03: page-home _chatSessionKey leak | FIXED — Cleared in disconnectedCallback |
| 7.5 | FL-08: oasis-search debounce leak | FIXED — Added disconnectedCallback with clearTimeout |

### Category 8: Performance — DONE (1/1)

| Fix | Finding | Status |
|-----|---------|--------|
| 8.1 | SM-10: Treasury fetches missing timeout | FIXED — AbortSignal.timeout(10s) on all 5 external fetch calls |

### Category 9: UI/UX Consistency — DONE (4/5)

| Fix | Finding | Status |
|-----|---------|--------|
| 9.1 | FM-07: Skeleton loader fixed width | DEFERRED — Low impact |
| 9.2 | FL-01: Theme ignores OS changes | FIXED — Added matchMedia listener for prefers-color-scheme |
| 9.3 | FL-07: theme-color meta hardcoded | FIXED — Updated dynamically when theme changes |
| 9.4 | FL-02: Loading spinner CSS orphaned | FIXED — Removed unused .app-loading CSS from index.html |
| 9.5 | FL-06: Duplicate sidebar icons | FIXED — Settings changed from ⚙️ to 🎛️ |

### Category 10: Code Quality Polish — PARTIAL (1/3)

| Fix | Finding | Status |
|-----|---------|--------|
| 10.1 | SL-01: 55+ console.log in production | DEFERRED — Requires careful review of each call |
| 10.2 | SL-02/03/10/11: Duplicate helpers | DEFERRED — Depends on route migration (Cat 3) |
| 10.3 | FL-04, FL-05: API path consistency | RESOLVED — ApiClient handles path prefixing; page-agent-detail is now deleted |

### Category 11: Configuration — DONE (1/2)

| Fix | Finding | Status |
|-----|---------|--------|
| 11.1 | SM-05: Hardcoded rebuild path | FIXED — Uses env var OASIS_UPDATE_SCRIPT with fallback to relative path |
| 11.2 | SL-05: $HOME vs CONFIG_DIR | DEFERRED — In dead modular routes, will be addressed with route migration |

---

## Files Modified (19)

- `server.js` — Security (HMAC auth, sanitize imports, --dangerously-skip-permissions, Gemini key, since param, fetch timeouts, cache cleanup, cron error fix)
- `server/middleware/auth.js` — Removed hardcoded credentials
- `server/routes/health.js` — Removed hardcoded credentials
- `server/routes/curator.js` — Gemini key to header
- `server/routes/audit.js` — Removed --dangerously-skip-permissions
- `server/routes/todos.js` — Removed --dangerously-skip-permissions
- `server/routes/features.js` — Removed --dangerously-skip-permissions
- `server/routes/ops.js` — Removed --dangerously-skip-permissions
- `server/routes/docker.js` — Removed hardcoded rebuild path
- `public/index.html` — Removed orphaned CSS
- `public/components/shell/oasis-app.js` — Fixed error display, removed dead code
- `public/components/shell/oasis-sidebar.js` — Fixed subscription leak, unique icons
- `public/components/shell/oasis-theme.js` — OS theme listener, meta tag update
- `public/components/shared/oasis-confirm.js` — Enter key fix, lazy keydown listener
- `public/components/shared/oasis-modal.js` — Lazy keydown listener
- `public/components/shared/oasis-toast.js` — Timer cleanup on disconnect
- `public/components/shared/oasis-table.js` — Cursor ternary fix
- `public/components/shared/oasis-search.js` — Debounce cleanup on disconnect
- `public/components/pages/page-agents.js` — Hash-prefix fix
- `public/components/pages/page-home.js` — Session key cleanup

## Files Created (1)

- `server/utils/sanitize.js` — sanitizePromptInput(), sanitizeDockerParam()

## Files Deleted (2)

- `public/index.v2.html` (3,583 lines)
- `public/components/pages/page-agent-detail.js` (420 lines)

---

## Known Remaining Issues (Deferred)

1. **Route migration (Cat 3)**: 18 modular routes need mounting, ~1150 inline LOC to remove. Highest-impact but highest-risk. Needs dedicated session with endpoint testing.
2. **Utility extraction (Cat 6.1-6.3)**: renderMarkdown (7 copies), timeAgo (8 copies), alert→toast (21 calls). Large refactor.
3. **Console.log cleanup (Cat 10.1)**: 67 calls. Needs per-call review (some are legitimate error logging).
4. **Helper consolidation (Cat 10.2)**: readJsonFile (6x), logActivity (9x), etc. Blocked by route migration.
5. **XSS in renderMarkdown (FC-02)**: Best addressed during utility extraction (Cat 6.1).
6. **WebSocket auth via URL (SH-07)**: Architecture-level change to websocket-server.js.

## Recommendations

1. **Priority 1**: Complete route migration (Cat 3) — activates mutex, validation, better error handling across all endpoints. Reduces server.js by ~1150 LOC.
2. **Priority 2**: Extract shared utilities (markdown, timeAgo, escapeHtml) — eliminates 7+ copies of divergent code.
3. **Priority 3**: Replace alert/confirm with toast/confirm components — consistent UX.
4. **Future**: Consider page decomposition (11 of 12 pages exceed 1285 LOC).
