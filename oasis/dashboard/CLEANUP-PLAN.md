# OASIS Dashboard — Cleanup Plan

**Date:** 2026-02-28
**Based on:** QA-REPORT.md (75 findings)
**Dashboard location:** `~/.openclaw/workspace-oasis/dashboard/`

---

## 1. Categorized Findings

### P0 — CRITICAL (Fix immediately)

| ID | Category | Finding | Fix Category |
|----|----------|---------|--------------|
| SC-01 | SECURITY | Hardcoded default credentials in modular auth/health | 1. Security |
| SC-02 | SECURITY | Command injection via unsanitized spawn() prompts | 1. Security |
| SC-03 | SECURITY | `--dangerously-skip-permissions` on all Claude CLI invocations | 1. Security |
| FC-03 | BUG | `_loadError` not reactive — error state never renders | 2. Critical Bugs |
| FC-04 | BUG | Page load catch swallows errors — perpetual spinner | 2. Critical Bugs |

### P1 — HIGH (Fix in this session)

| ID | Category | Finding | Fix Category |
|----|----------|---------|--------------|
| SH-01 | TECH-DEBT | 1150 LOC inline routes duplicate 18 modular files | 3. Route Architecture |
| SH-02 | BUG | Race conditions in inline todo ops (no mutex) | 3. Route Architecture |
| SH-03 | BUG | Inline writeTodos() not atomic | 3. Route Architecture |
| SH-04 | SECURITY | Auth bypass: inconsistent empty vs hardcoded defaults | 1. Security |
| SH-05 | SECURITY | Gemini API key in URL query parameter | 1. Security |
| SH-07 | SECURITY | WebSocket auth via credentials in URL | 1. Security |
| SM-01 | SECURITY | Timing-unsafe auth in inline basicAuth | 1. Security |
| SM-02 | SECURITY | Rate-limit and security-headers middleware not applied | 1. Security |
| SM-04 | SECURITY | `since` param in Docker logs not sanitized | 1. Security |
| SM-09 | SECURITY | No input sanitization on audit findings | 1. Security |
| FC-02 | SECURITY | XSS via 7 divergent renderMarkdown() with .innerHTML | 6. Component Refactoring |
| FH-01 | CODE-QUALITY | renderMarkdown() duplicated 7 times | 6. Component Refactoring |
| FH-02 | CODE-QUALITY | timeAgo() duplicated 8 times | 6. Component Refactoring |
| FH-03 | UI/UX | 21+ alert()/confirm() calls | 6. Component Refactoring |
| FH-06 | BUG | Enter key always confirms in oasis-confirm | 5. Error Handling |
| SH-06 | BUG | No mutex on Nolan/Aech/Dito data files | 3. Route Architecture |
| FH-04 | BUG | Sidebar route subscription leak | 7. State Management |
| FH-05 | BUG | page-home.js declares static styles twice | 6. Component Refactoring |

### P2 — MEDIUM (Fix in this session)

| ID | Category | Finding | Fix Category |
|----|----------|---------|--------------|
| SM-03 | PERFORMANCE | prevSessionState/prevCronState unbounded growth | 7. State Management |
| SM-05 | CONFIG | Docker rebuild hardcoded path | 4. Configuration |
| SM-06 | CODE-QUALITY | runOasisOps() duplicated 3 times | 6. Component Refactoring |
| SM-07 | PERFORMANCE | Inline txHistory cache never cleaned | 7. State Management |
| SM-10 | PERFORMANCE | Missing AbortController on inline treasury fetch | 8. Performance |
| SM-11 | DEAD-CODE | Gateway monitor never started | 3. Route Architecture |
| SM-12 | CODE-QUALITY | Two rpcCall implementations | 3. Route Architecture |
| FM-01 | BUG | oasis-toast setTimeout not cleared on disconnect | 5. Error Handling |
| FM-02 | PERFORMANCE | oasis-modal keydown listener always active | 6. Component Refactoring |
| FM-03 | PERFORMANCE | oasis-confirm keydown listener always active | 6. Component Refactoring |
| FM-05 | BUG | oasis-tabs slot visibility conflicts Shadow DOM | 6. Component Refactoring |
| FM-06 | BUG | Hash-prefixed paths in router.navigate() | 6. Component Refactoring |
| FM-08 | DEAD-CODE | _createPageElement() dead code | 4. Dead Code |
| FM-09 | BUG | oasis-table cursor ternary always default | 6. Component Refactoring |
| FM-10 | CODE-QUALITY | Most shared components unused by pages | 6. Component Refactoring |
| FC-01 | DEAD-CODE | page-agent-detail.js orphaned | 4. Dead Code |
| FI-01 | DEAD-CODE | index.v2.html (3583 LOC) dead code | 4. Dead Code |
| SM-08 | PERFORMANCE | Dual scheduler pollers could double-execute | 3. Route Architecture |
| FM-04 | CODE-QUALITY | page-settings lacks disconnectedCallback | 6. Component Refactoring |
| FM-07 | UI/UX | Skeleton loader fixed 80px width | 9. UI/UX |

### P3 — LOW (Fix if time allows)

| ID | Category | Finding | Fix Category |
|----|----------|---------|--------------|
| SL-01 | CODE-QUALITY | 55 console.log calls in production | 10. Code Quality |
| SL-02 | CODE-QUALITY | readJsonFile duplicated 6 times | 10. Code Quality |
| SL-03 | CODE-QUALITY | logActivity duplicated 9 times | 10. Code Quality |
| SL-04 | BUG | Inline audio filename regex too strict | 6. Component Refactoring |
| SL-05 | CONFIG | Feature/audit routes use $HOME vs CONFIG_DIR | 4. Configuration |
| SL-06 | BUG | Dito leads use array index as ID | 6. Component Refactoring |
| SL-07 | SECURITY | CSP allows unsafe-inline (in unused middleware) | 1. Security |
| SL-08 | BUG | Chat SSE lacks req.on("close") cleanup | 5. Error Handling |
| SL-09 | BUG | Inline cron catch references outer err | 5. Error Handling |
| SL-10 | CODE-QUALITY | parseDockerLogs duplicated | 10. Code Quality |
| SL-11 | CODE-QUALITY | dockerRequest duplicated | 10. Code Quality |
| FL-01 | UI/UX | Theme ignores prefers-color-scheme runtime changes | 9. UI/UX |
| FL-02 | UI/UX | Loading spinner CSS targets nonexistent element | 9. UI/UX |
| FL-03 | BUG | page-home _chatSessionKey not cleared | 7. State Management |
| FL-04 | CODE-QUALITY | page-agent-detail API paths missing prefix | 10. Code Quality |
| FL-05 | CODE-QUALITY | page-business API paths missing prefix | 10. Code Quality |
| FL-06 | UI/UX | Duplicate sidebar icons | 9. UI/UX |
| FL-07 | UI/UX | theme-color meta hardcoded dark | 9. UI/UX |
| FL-08 | BUG | oasis-search debounce not cleared | 7. State Management |
| FL-09 | BUG | oasis-modal footer :empty unreliable | 6. Component Refactoring |

### P4 — INFO (Document only)

| ID | Finding |
|----|---------|
| SI-01 | server.js 1674 LOC (will be resolved by route migration) |
| SI-02 | Wallet addresses in 3 places (will be resolved by route migration) |
| SI-03 | Feature SSE supports only one client |
| SI-04 | No CORS (acceptable for direct-access) |
| SI-05 | express.json after express.static (harmless) |
| SI-06 | No explicit body size limits (100KB default OK) |
| FI-02 | Accessibility well-handled |
| FI-03 | Theme system well-structured |
| FI-04 | Timer cleanup verified across all pages |
| FI-05 | 11/12 pages exceed 1285 LOC (future decomposition) |
| FI-06 | 0 npm vulnerabilities, deps lean |
| FI-07 | 18 unmounted route modules (will be resolved by route migration) |

---

## 2. Fix Order

### Category 1: Security Fixes

**Scope:** 8 files modified

#### Fix 1.1 — Remove hardcoded default credentials (SC-01, SH-04)
- **Files:** `server/middleware/auth.js`, `server/routes/health.js`
- **Current:** `const AUTH_USER = process.env.OPENCLAW_DASHBOARD_USERNAME || "oasis"`
- **Fix:** Change fallback to empty string: `|| ""`. When empty, auth should be disabled with a console warning. This matches the inline server.js behavior.
- **Risk:** None — env vars are already set in production.

#### Fix 1.2 — Sanitize user input flowing into Claude prompts (SC-02)
- **Files:** `server.js` (inline todo/audit spawn), `server/routes/todos.js`, `server/routes/features.js`, `server/routes/audit.js`
- **Current:** User-supplied title/description interpolated directly into prompt strings
- **Fix:** Create a `sanitizePromptInput(str, maxLen=500)` function that: strips control characters, trims to max length, escapes backticks and template literals. Apply to all fields before interpolation.
- **Risk:** Low — only affects prompt formatting, not functionality. Verify todo execution still works.
- **Depends on:** Nothing

#### Fix 1.3 — Remove `--dangerously-skip-permissions` (SC-03)
- **Files:** All `spawn("claude", ...)` calls in server.js, todos.js, features.js, audit.js
- **Current:** `spawn("claude", ["--dangerously-skip-permissions", "--print", prompt], ...)`
- **Fix:** Replace with `spawn("claude", ["--print", prompt], ...)`. The dashboard runs inside Docker where permissions are already sandboxed by container isolation.
- **Risk:** Medium — Claude may refuse some operations that previously worked. Test todo execution and audit triggers after this change.
- **Depends on:** Fix 1.2 (sanitization first, then permission tightening)

#### Fix 1.4 — Apply rate-limit and security-headers middleware (SM-02)
- **Files:** `server.js`
- **Current:** Middleware files exist but are not imported
- **Fix:** Add imports and `app.use()` calls:
  ```js
  import securityHeaders from "./server/middleware/security-headers.js";
  import rateLimit from "./server/middleware/rate-limit.js";
  app.use(securityHeaders);
  app.use(rateLimit);
  ```
- **Risk:** Low — verify no requests are accidentally blocked by rate limits. The security-headers CSP allows unsafe-inline (SL-07), which is acceptable for now since the frontend uses inline styles.
- **Depends on:** Nothing

#### Fix 1.5 — Move Gemini API key from URL to header (SH-05)
- **Files:** `server.js` (inline curator chat), `server/routes/curator.js`
- **Current:** `?key=${GEMINI_API_KEY}` in URL
- **Fix:** Use `x-goog-api-key` header instead:
  ```js
  headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY }
  ```
  Remove `key=` from URL. The Gemini API supports this header.
- **Risk:** Low — verify Gemini streaming still works.
- **Depends on:** Nothing

#### Fix 1.6 — Sanitize Docker logs `since` parameter (SM-04)
- **File:** `server.js` (inline Docker logs route)
- **Current:** `const since = req.query.since || ""`
- **Fix:** Add sanitization: `const since = (req.query.since || "").replace(/[^0-9T:.Z-]/g, "")`
- **Risk:** None
- **Depends on:** Nothing

#### Fix 1.7 — Sanitize audit findings input (SM-09)
- **File:** `server.js` (generate-tasks endpoint)
- **Current:** `const title = (typeof finding === "string" ? finding : finding.title || ...)`.substring(0, 500)`
- **Fix:** Apply `sanitizePromptInput()` from Fix 1.2 to title and description fields before creating todos.
- **Risk:** None
- **Depends on:** Fix 1.2

#### Fix 1.8 — Improve timing-safe auth (SM-01)
- **File:** `server.js` inline basicAuth
- **Current:** Uses `timingSafeEqual` but leaks length
- **Fix:** Use HMAC comparison (same pattern as modular auth.js):
  ```js
  function safeCompare(a, b) {
    const hmacA = createHmac("sha256", "dashboard-auth").update(a).digest();
    const hmacB = createHmac("sha256", "dashboard-auth").update(b).digest();
    return timingSafeEqual(hmacA, hmacB);
  }
  ```
- **Risk:** None
- **Depends on:** Nothing

### Category 2: Critical Bug Fixes

**Scope:** 1 file modified

#### Fix 2.1 — Fix oasis-app.js error display (FC-03, FC-04)
- **File:** `public/components/shell/oasis-app.js`
- **Current:** `_loadError` is not in `static properties`; catch block sets unused `_stubPage`
- **Fix:**
  1. Add `_loadError: { type: String, state: true }` to `static properties`
  2. In the catch block (line ~370), set `this._loadError = error.message || 'Failed to load page'` instead of setting `_stubPage`
  3. Remove unused `_stubPage` references
- **Risk:** None — this fixes broken error display
- **Depends on:** Nothing

### Category 3: Route Architecture (Mount Modular Routes)

**Scope:** `server.js` + potentially all 18 route modules

> **NOTE:** This is the single highest-impact change. It activates mutex-protected file I/O, better validation, and ~18 entire feature sets. However, it is also the highest-risk change because the modular routes may have slightly different behavior than the inline ones.

#### Fix 3.1 — Mount all modular routes and remove inline duplicates
- **File:** `server.js`
- **Current:** Only health, docker, chat are imported/mounted. ~1150 lines of inline routes.
- **Fix:**
  1. Import all 18 remaining route modules
  2. Mount each with `app.use("/api/...", routeModule)`
  3. Remove the corresponding inline route handlers from server.js
  4. Keep shared state (activityLog, cache, WALLETS, etc.) accessible to route modules via `app.locals` or dependency injection
  5. Consolidate duplicate helpers (rpcCall, readJsonFile, logActivity, runOasisOps, parseDockerLogs, dockerRequest) into shared modules under `server/utils/`
- **Risk:** HIGH — extensive change. Must verify every endpoint still works. The modular routes may use different response formats or error codes. Must test: todos CRUD, cron CRUD, agents list, treasury, voice, curator, audit, recipes, ops.
- **Depends on:** Fix 1.1 (credential defaults), Fix 1.2 (sanitization), Fix 1.8 (auth)
- **Rollback:** Keep inline routes commented out (not deleted) until verification complete

#### Fix 3.2 — Consolidate rpcCall implementations (SM-12)
- **Files:** `server.js`, `server/services/gateway-client.js`
- **Current:** Two separate implementations
- **Fix:** Have server.js import and use `rpcCall` from `gateway-client.js`. Remove inline version.
- **Risk:** Low — verify client ID difference doesn't matter
- **Depends on:** Fix 3.1

#### Fix 3.3 — Add mutex to Nolan/Aech/Dito file operations (SH-06)
- **Files:** `server/routes/nolan.js`, `server/routes/aech.js`, `server/routes/dito.js`
- **Fix:** Import `withMutex` from `server/utils/file-mutex.js` and wrap all read-modify-write operations
- **Risk:** Low
- **Depends on:** Fix 3.1 (routes must be mounted first)

### Category 4: Dead Code Removal

**Scope:** 3 files deleted, 1 file modified

#### Fix 4.1 — Delete index.v2.html (FI-01)
- **File:** `public/index.v2.html` (3583 lines)
- **Action:** Delete entirely
- **Risk:** None — not referenced anywhere

#### Fix 4.2 — Delete or repurpose page-agent-detail.js (FC-01)
- **File:** `public/components/pages/page-agent-detail.js` (420 lines)
- **Current:** Registered as custom element but no route points to it
- **Action:** Delete. The `page-agents.js` handles detail views internally via `:id` param.
- **Risk:** None — verify page-agents handles /agents/:id correctly

#### Fix 4.3 — Remove dead code in oasis-app.js (FM-08)
- **File:** `public/components/shell/oasis-app.js`
- **Action:** Remove `_createPageElement()` method and `_stubPage` references
- **Risk:** None
- **Depends on:** Fix 2.1

### Category 5: Error Handling

**Scope:** 3 files modified

#### Fix 5.1 — Fix oasis-confirm Enter key behavior (FH-06)
- **File:** `public/components/shared/oasis-confirm.js`
- **Current:** Global Enter always confirms regardless of focus
- **Fix:** Check if confirm button has focus before auto-confirming:
  ```js
  if (e.key === 'Enter') {
    const focused = this.shadowRoot.activeElement;
    if (!focused || focused === confirmBtn) this._resolve(true);
  }
  ```
- **Risk:** None

#### Fix 5.2 — Clear oasis-toast timeouts on disconnect (FM-01)
- **File:** `public/components/shared/oasis-toast.js`
- **Fix:** Store timeout IDs in an array, clear all in `disconnectedCallback`
- **Risk:** None

#### Fix 5.3 — Add req.on("close") to chat SSE (SL-08)
- **File:** `server/routes/chat.js`
- **Fix:** Add abort controller and cleanup on client disconnect
- **Risk:** None

#### Fix 5.4 — Fix inline cron catch variable reference (SL-09)
- **File:** `server.js`
- **Fix:** Add proper error variable to inner catch: `catch (readErr) { res.status(500).json({ error: readErr.message }); }`
- **Risk:** None

### Category 6: Component Refactoring

**Scope:** ~15 files modified

#### Fix 6.1 — Extract shared renderMarkdown() utility (FC-02, FH-01)
- **Action:** Create `public/app/markdown.js` with the most robust `renderMarkdown()` implementation (from oasis-markdown.js or page-knowledge.js). Include URL scheme sanitization. Export as module.
- **Files modified:** 7 page components (replace inline renderMarkdown with import)
- **Risk:** Medium — must verify markdown renders identically on every page. Test with agent responses, workspace files, recipe content, chat messages.

#### Fix 6.2 — Extract shared timeAgo() and escapeHtml() utilities (FH-02)
- **Action:** Create `public/app/utils.js` with `timeAgo()`, `escapeHtml()`, `formatDuration()`, `formatBytes()`
- **Files modified:** 8 page components
- **Risk:** Low — pure functions, easy to verify

#### Fix 6.3 — Replace alert()/confirm() with toast/confirm components (FH-03)
- **Files:** `page-operations.js` (9), `page-agents.js` (5), `page-knowledge.js` (7)
- **Fix:** Replace `alert(msg)` with `showToast(msg, 'error')` and `confirm(msg)` with `await OasisConfirm.show({ title, message, confirmLabel, danger })`
- **Risk:** Low — UI improvement, verify each confirm dialog still blocks correctly

#### Fix 6.4 — Fix page-home.js duplicate static styles (FH-05)
- **File:** `public/components/pages/page-home.js`
- **Fix:** Merge both `static styles` blocks into one
- **Risk:** None

#### Fix 6.5 — Fix oasis-modal/confirm keydown listeners (FM-02, FM-03)
- **Files:** `oasis-modal.js`, `oasis-confirm.js`
- **Fix:** Add/remove keydown listener in `updated()` when open state changes, not in connectedCallback
- **Risk:** Low — verify Escape key still closes modals

#### Fix 6.6 — Fix oasis-tabs slot visibility (FM-05)
- **File:** `public/components/shared/oasis-tabs.js`
- **Fix:** Use `.active` CSS class instead of conflicting inline style + CSS rule
- **Risk:** Low — verify tabs still switch correctly

#### Fix 6.7 — Fix hash-prefixed router.navigate() calls (FM-06)
- **Files:** `page-agents.js`, `page-home.js`
- **Fix:** Remove `#` prefix: `router.navigate('/operations')` not `router.navigate('#/operations')`
- **Risk:** None — router already strips `#`

#### Fix 6.8 — Fix oasis-table cursor ternary (FM-09)
- **File:** `public/components/shared/oasis-table.js`
- **Fix:** Change to `cursor: ${row.__clickable !== false ? 'pointer' : 'default'}`
- **Risk:** None

#### Fix 6.9 — Add page-settings disconnectedCallback (FM-04)
- **File:** `page-settings.js`
- **Fix:** Add empty `disconnectedCallback() { super.disconnectedCallback(); }` stub
- **Risk:** None

#### Fix 6.10 — Consolidate runOasisOps() (SM-06)
- **Files:** `server.js`, `server/routes/todos.js`, `server/routes/features.js`
- **Fix:** Extract to `server/utils/oasis-ops.js`, import everywhere
- **Risk:** Low
- **Depends on:** Fix 3.1

### Category 7: State Management

**Scope:** 4 files modified

#### Fix 7.1 — Fix sidebar route subscription leak (FH-04)
- **File:** `public/components/shell/oasis-sidebar.js`
- **Fix:** Call stored unsub function in `disconnectedCallback`:
  ```js
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._routeUnsub) this._routeUnsub();
  }
  ```
- **Risk:** None

#### Fix 7.2 — Add periodic cleanup for prevSessionState/prevCronState (SM-03)
- **File:** `server.js`
- **Fix:** Add `setInterval` every 10 minutes that prunes entries older than 24 hours
- **Risk:** None

#### Fix 7.3 — Add txHistory cache cleanup (SM-07)
- **File:** `server.js`
- **Fix:** Add `setInterval` every 10 minutes to prune expired entries from `cache.txHistory`
- **Risk:** None

#### Fix 7.4 — Clear _chatSessionKey on disconnect (FL-03)
- **File:** `page-home.js`
- **Fix:** Add `this._chatSessionKey = null` in disconnectedCallback
- **Risk:** None

#### Fix 7.5 — Clear oasis-search debounce on disconnect (FL-08)
- **File:** `oasis-search.js`
- **Fix:** Add `clearTimeout(this._debounceTimer)` in disconnectedCallback
- **Risk:** None

### Category 8: Performance

**Scope:** 1 file modified

#### Fix 8.1 — Add AbortSignal timeouts to inline treasury fetches (SM-10)
- **File:** `server.js`
- **Fix:** Add `signal: AbortSignal.timeout(10000)` to all `fetch()` calls in treasury functions
- **Risk:** None

### Category 9: UI/UX Consistency

**Scope:** 5 files modified

#### Fix 9.1 — Fix skeleton loader widths (FM-07)
- **File:** `page-home.js`
- **Fix:** Accept width parameter: `_renderSkeleton(width = '80px')`
- **Risk:** None

#### Fix 9.2 — Add prefers-color-scheme runtime listener (FL-01)
- **File:** `oasis-theme.js`
- **Fix:** Add `matchMedia` listener for runtime OS theme changes
- **Risk:** None

#### Fix 9.3 — Fix theme-color meta tag (FL-07)
- **File:** `oasis-theme.js`
- **Fix:** Update `<meta name="theme-color">` content when theme changes
- **Risk:** None

#### Fix 9.4 — Remove unused loading spinner CSS (FL-02)
- **File:** `public/index.html`
- **Fix:** Remove the `.app-loading` and `oasis-app:defined` CSS rules that target nonexistent elements
- **Risk:** None

#### Fix 9.5 — Fix duplicate sidebar icons (FL-06)
- **File:** `oasis-sidebar.js`
- **Fix:** Use distinct icons for Operations vs Settings
- **Risk:** None

### Category 10: Code Quality Polish

**Scope:** ~10 files modified

#### Fix 10.1 — Remove unnecessary console.log statements (SL-01)
- **Files:** All server and client files
- **Fix:** Remove debug-only console.log. Keep console.error in catch blocks. Replace console.warn in meaningful locations with proper structured logging.
- **Risk:** Low

#### Fix 10.2 — Consolidate readJsonFile, logActivity, parseDockerLogs, dockerRequest helpers (SL-02, SL-03, SL-10, SL-11)
- **Fix:** Extract to shared modules under `server/utils/`. Import everywhere.
- **Risk:** Low
- **Depends on:** Fix 3.1

#### Fix 10.3 — Fix API path consistency (FL-04, FL-05)
- **Files:** `page-agent-detail.js`, `page-business.js`
- **Fix:** These files are dead code (page-agent-detail) or use the ApiClient which correctly prepends `/api/`. No change needed — the ApiClient._url() method handles this. Mark as resolved.
- **Risk:** None

### Category 11: Configuration

**Scope:** 2 files modified

#### Fix 11.1 — Remove hardcoded rebuild path (SM-05)
- **File:** `server/routes/docker.js`
- **Fix:** Use `path.resolve(__dirname, '../../scripts/oasis-weekly-update.sh')` or an env var
- **Risk:** Low — verify rebuild still works

#### Fix 11.2 — Fix $HOME vs CONFIG_DIR inconsistency (SL-05)
- **Files:** `server/routes/features.js`, `server/routes/audit.js`
- **Fix:** Use `CONFIG_DIR` consistently (passed via `app.locals` or module-level const)
- **Risk:** Low — verify file paths resolve correctly in Docker
- **Depends on:** Fix 3.1

### Categories 12-16: Deferred

**12. Accessibility** — No action needed. Audit found accessibility well-handled (FI-02).

**13. Documentation** — The QA-REPORT.md, QA-SERVER-AUDIT.md, QA-FRONTEND-AUDIT.md, and this CLEANUP-PLAN.md serve as documentation. No inline doc changes needed.

**14. TODO/FIXME Resolution** — Audit found zero TODO/FIXME/HACK comments in the dashboard codebase. No action needed.

**15. oasis-modal footer :empty fix (FL-09)** — Low priority, deferred. The fix requires reworking slot detection with `slotchange` events.

**16. Shared component adoption (FM-10)** — Large refactor to make pages use oasis-card, oasis-table, etc. Deferred to future session. Document as recommendation.

---

## 3. Scope Estimate

### Issues by severity
| Severity | Count |
|----------|-------|
| P0 (Critical) | 5 |
| P1 (High) | 14 |
| P2 (Medium) | 20 |
| P3 (Low) | 20 |
| P4 (Info/Doc) | 12 |

### Files to modify
- **Server:** `server.js`, 18 route modules, 3 middleware, 3 utils, 4 services (~30 files)
- **Frontend:** `oasis-app.js`, `oasis-confirm.js`, `oasis-modal.js`, `oasis-toast.js`, `oasis-tabs.js`, `oasis-table.js`, `oasis-sidebar.js`, `oasis-theme.js`, `oasis-search.js`, `index.html`, 7 page components (~18 files)

### Files to delete
- `public/index.v2.html` (3583 lines)
- `public/components/pages/page-agent-detail.js` (420 lines)

### Files to create
- `public/app/markdown.js` (shared renderMarkdown)
- `public/app/utils.js` (shared timeAgo, escapeHtml, etc.)
- `server/utils/oasis-ops.js` (shared runOasisOps)
- `server/utils/sanitize.js` (shared sanitizePromptInput)

### Dependencies to add/remove/update
- None required. Express 5.x upgrade deferred (major version, not urgent).

### Breaking changes
- Fix 1.3 (removing --dangerously-skip-permissions) may cause some Claude CLI operations to fail if they require file/exec permissions. Test thoroughly.
- Fix 3.1 (mounting modular routes) changes ~50 API endpoints. Response formats should be identical but must be verified.

### Rollback strategy
- Git branch created before Phase 3 (`qa-cleanup-YYYYMMDD`)
- Each fix category committed separately
- If build breaks, revert the last commit and investigate
- If route migration causes API issues, the inline routes can be re-enabled by reverting Fix 3.1 commit

---

## 4. Execution Order Summary

| # | Category | Fixes | Est. Files | Priority |
|---|----------|-------|------------|----------|
| 1 | Security | 1.1–1.8 | 8 | P0/P1 |
| 2 | Critical Bugs | 2.1 | 1 | P0 |
| 3 | Route Architecture | 3.1–3.3 | ~30 | P1 |
| 4 | Dead Code | 4.1–4.3 | 3 deleted, 1 modified | P2 |
| 5 | Error Handling | 5.1–5.4 | 3 | P1/P2 |
| 6 | Component Refactoring | 6.1–6.10 | ~15 | P1/P2 |
| 7 | State Management | 7.1–7.5 | 5 | P1/P2 |
| 8 | Performance | 8.1 | 1 | P2 |
| 9 | UI/UX | 9.1–9.5 | 5 | P3 |
| 10 | Code Quality | 10.1–10.3 | ~10 | P3 |
| 11 | Configuration | 11.1–11.2 | 2 | P3 |
