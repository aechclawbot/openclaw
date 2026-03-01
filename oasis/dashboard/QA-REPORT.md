# OASIS Dashboard — Comprehensive QA Report

**Date:** 2026-02-28
**Dashboard Version:** v3 (Lit Web Components)
**Location:** `~/.openclaw/workspace-oasis/dashboard/`
**Scope:** Full-stack audit — server (32 files), frontend (28 components), config, dependencies, Docker

---

## 1. PROJECT INVENTORY

### Architecture
- **Backend:** Express.js 4.x + Node 22, monolithic `server.js` (1674 LOC) with partially migrated modular routes
- **Frontend:** Lit Web Components SPA, hash-based router, 12 pages + 4 shell + 10 shared components
- **Real-time:** WebSocket (dashboard-server WS + gateway RPC via transient WS connections)
- **Docker:** 4 services (gateway, dashboard, audio-listener, docker-socket-proxy) + CLI profile

### Pages/Routes (13)
`/` (Home), `/agents`, `/agents/:id`, `/chat`, `/chat/:agentId`, `/operations`, `/knowledge`, `/business`, `/household`, `/analytics`, `/tools`, `/spawn`, `/settings`

### API Endpoints (53 active inline + 3 mounted modules)
Full inventory in QA-SERVER-AUDIT.md

### Server Files (32)
- `server.js` (main, 1674 LOC)
- `server/routes/` (21 files) — only 3 mounted (health, docker, chat); 18 dead
- `server/middleware/` (3 files) — auth.js active; rate-limit.js, security-headers.js dead
- `server/services/` (5 files)
- `server/utils/` (3 files)

### Frontend Files (28 components + 3 CSS + 2 HTML)
- Shell: oasis-app, oasis-theme, oasis-topbar, oasis-sidebar
- Shared: toast, modal, confirm, card, table, markdown, badge, search, tabs, empty
- Pages: home, agents, agent-detail(dead), chat, operations, knowledge, analytics, business, household, tools, settings, spawn
- CSS: reset.css, theme.css, global.css
- HTML: index.html, index.v2.html (dead)

### Dependencies (2 runtime)
- express ^4.21.0 (current: 4.22.1, latest: 5.2.1)
- ws ^8.18.0

---

## 2. FINDINGS BY SEVERITY

### CRITICAL (7)

| ID | Category | Finding | Location |
|----|----------|---------|----------|
| SC-01 | SECURITY | Hardcoded default credentials (`oasis`/`ReadyPlayer@1`) in modular auth middleware and health route | auth.js:8-9, health.js:14-15 |
| SC-02 | SECURITY | Command injection via unsanitized user input in `spawn("claude", ...)` prompts (todos, features, audit) | server.js:807-815, todos.js:125-130, features.js:145-150 |
| SC-03 | SECURITY | `--dangerously-skip-permissions` on all Claude CLI invocations | All spawn() calls |
| FC-01 | DEAD-CODE | `page-agent-detail.js` registered but unreachable (no route in PAGE_MAP) | page-agent-detail.js |
| FC-02 | SECURITY | XSS risk: 7 divergent `renderMarkdown()` implementations with `.innerHTML`, varying URL sanitization | page-chat.js:789, page-agents.js:860+, page-knowledge.js:2306+, etc. |
| FC-03 | BUG | `_loadError` not declared as Lit reactive property — error state never renders | oasis-app.js |
| FC-04 | BUG | Page load catch block swallows errors, sets unused `_stubPage` — perpetual spinner on failure | oasis-app.js:370-378 |

### HIGH (13)

| ID | Category | Finding | Location |
|----|----------|---------|----------|
| SH-01 | TECH-DEBT | ~1150 lines of inline routes in server.js duplicate 18 modular route files (which are dead code) | server.js:503-1660 vs server/routes/*.js |
| SH-02 | BUG | Race conditions in inline todo file operations (no mutex) — modular version has mutex but is dead | server.js:910-1113 |
| SH-03 | BUG | Inline `writeTodos()` is not atomic (write-to-temp-then-rename pattern missing) | server.js:779-781 |
| SH-04 | SECURITY | Auth bypass gap: modular middleware has hardcoded defaults vs inline has empty defaults | server.js:21 vs auth.js:8 |
| SH-05 | SECURITY | Gemini API key passed in URL query parameter (appears in logs) | server.js:1364, curator.js:275 |
| SH-06 | BUG | No mutex on Nolan/Aech/Dito data files — concurrent corruption risk | nolan.js, aech.js, dito.js |
| SH-07 | SECURITY | WebSocket auth via base64 credentials in URL query parameter | websocket-server.js:58-67 |
| FH-01 | CODE-QUALITY | `renderMarkdown()` duplicated across 7 page components with divergent behavior | page-home/agents/chat/knowledge/tools/household/spawn.js |
| FH-02 | CODE-QUALITY | `timeAgo()` duplicated across 8 page components with inconsistent semantics | 8 page files |
| FH-03 | UI/UX | 21+ native `alert()`/`confirm()` calls instead of `oasis-toast`/`oasis-confirm` | page-operations (9), page-agents (5), page-knowledge (7) |
| FH-04 | BUG | Sidebar route subscription leaks (unsub stored but never called) | oasis-sidebar.js:210 |
| FH-05 | BUG | `page-home.js` declares `static styles` twice — first silently discarded | page-home.js:754 |
| FH-06 | BUG | `oasis-confirm` Enter key always confirms regardless of focus | oasis-confirm.js:243-247 |

### MEDIUM (22)

| ID | Category | Finding | Location |
|----|----------|---------|----------|
| SM-01 | SECURITY | Timing-unsafe auth in inline basicAuth (length leak) vs HMAC in modular (dead) | server.js:212-218 |
| SM-02 | SECURITY | Rate-limit and security-headers middleware exist but never applied | rate-limit.js, security-headers.js |
| SM-03 | PERFORMANCE | `prevSessionState`/`prevCronState` grow unbounded (memory leak) | server.js:69-70 |
| SM-04 | SECURITY | `since` param in inline Docker logs route not sanitized | server.js:1285 |
| SM-05 | CONFIG | Docker rebuild hardcoded path `/Users/oasis/openclaw/scripts/oasis-weekly-update.sh` | docker.js:229 |
| SM-06 | CODE-QUALITY | `runOasisOps()` duplicated 3 times | server.js:784, todos.js:29, features.js:19 |
| SM-07 | PERFORMANCE | Inline `txHistory` cache never cleaned (memory leak) | server.js:48-50 |
| SM-08 | PERFORMANCE | Both inline and modular scheduler pollers could double-execute if both mounted | server.js:859, todos.js:192 |
| SM-09 | SECURITY | No input sanitization on audit findings passed to generate-tasks | server.js:1251-1280 |
| SM-10 | PERFORMANCE | Missing AbortController timeouts on inline treasury fetch calls | server.js:376-501 |
| SM-11 | DEAD-CODE | Gateway monitor connection (`startMonitorConnection`) never started | gateway-client.js:223 |
| SM-12 | CODE-QUALITY | Two duplicate `rpcCall` implementations with different client IDs | server.js:228, gateway-client.js:24 |
| FM-01 | BUG | `oasis-toast` setTimeout handles not cleared on disconnect | oasis-toast.js |
| FM-02 | PERFORMANCE | `oasis-modal` global keydown listener active even when closed | oasis-modal.js:152-160 |
| FM-03 | PERFORMANCE | `oasis-confirm` global keydown listener active even when closed | oasis-confirm.js:153-160 |
| FM-04 | CODE-QUALITY | `page-settings.js` lacks `disconnectedCallback` | page-settings.js |
| FM-05 | BUG | `oasis-tabs` slot visibility mechanism conflicts with Shadow DOM CSS | oasis-tabs.js:158-165 |
| FM-06 | BUG | Hash-prefixed paths passed to `router.navigate()` inconsistently | page-agents.js, page-home.js |
| FM-07 | UI/UX | Skeleton loader uses fixed 80px width regardless of context | page-home.js:473-475 |
| FM-08 | DEAD-CODE | `_createPageElement()` in oasis-app.js is dead code | oasis-app.js:335-345 |
| FM-09 | BUG | `oasis-table` row cursor ternary always evaluates to `default` | oasis-table.js:216 |
| FM-10 | CODE-QUALITY | Most shared components (card, badge, search, tabs, empty, markdown, table, modal) unused by pages | Multiple files |

### LOW (20)

| ID | Category | Finding | Location |
|----|----------|---------|----------|
| SL-01 | CODE-QUALITY | Excessive console.log in production (~55 calls) | Throughout |
| SL-02 | CODE-QUALITY | `readJsonFile` helper duplicated 6 times | 6 files |
| SL-03 | CODE-QUALITY | `logActivity` helper duplicated 9 times with divergent behavior | 9 files |
| SL-04 | BUG | Inline audio filename regex too strict (rejects `boosted_` prefix files) | server.js:1630 |
| SL-05 | CONFIG | Feature/audit routes use `$HOME` while others use `CONFIG_DIR` (Docker path mismatch) | features.js:13, audit.js:13 |
| SL-06 | BUG | Dito leads use array index as ID — concurrent operations corrupt wrong entry | dito.js:95-110 |
| SL-07 | SECURITY | CSP in unused security-headers allows `unsafe-inline` | security-headers.js:15-16 |
| SL-08 | BUG | Chat SSE stream lacks `req.on("close")` cleanup | chat.js:17 |
| SL-09 | BUG | Inline cron catch references outer `err` variable | server.js:568 |
| SL-10 | CODE-QUALITY | `parseDockerLogs` duplicated in server.js and docker-client.js | 2 files |
| SL-11 | CODE-QUALITY | `dockerRequest` duplicated (inline lacks Content-Type header) | 2 files |
| FL-01 | UI/UX | Theme does not listen for `prefers-color-scheme` runtime changes | oasis-theme.js |
| FL-02 | UI/UX | Loading spinner CSS rule targets nonexistent `.app-loading` sibling | index.html:47-49 |
| FL-03 | BUG | `page-home.js` `_chatSessionKey` not cleared on disconnect | page-home.js:143 |
| FL-04 | CODE-QUALITY | `page-agent-detail.js` API paths missing `/api/` prefix | page-agent-detail.js:303-304 |
| FL-05 | CODE-QUALITY | `page-business.js` API paths missing `/api/` prefix | page-business.js:224-256 |
| FL-06 | UI/UX | Sidebar uses duplicate icons for Operations and Settings | oasis-sidebar.js:13,20 |
| FL-07 | UI/UX | `theme-color` meta tag hardcoded to dark theme | index.html:8 |
| FL-08 | BUG | `oasis-search.js` debounce timer not cleared on disconnect | oasis-search.js |
| FL-09 | BUG | `oasis-modal.js` footer slot `:empty` detection unreliable | oasis-modal.js:110-113 |

### INFO (13)

| ID | Category | Finding |
|----|----------|---------|
| SI-01 | CODE-QUALITY | `server.js` at 1674 LOC far exceeds 500-700 LOC guideline |
| SI-02 | CONFIG | Wallet addresses defined in 3 places with inconsistent sets (inline missing "oasis" wallet) |
| SI-03 | PERFORMANCE | Feature progress SSE supports only one client per feature |
| SI-04 | CONFIG | No CORS configuration (acceptable for direct-access dashboard) |
| SI-05 | CODE-QUALITY | `express.json()` applied after `express.static()` (harmless but unnecessary for static requests) |
| SI-06 | CONFIG | No explicit request body size limits (express default 100KB is reasonable) |
| FI-01 | DEAD-CODE | `index.v2.html` (3583 lines) is legacy dead code — not referenced anywhere |
| FI-02 | ACCESSIBILITY | Accessibility generally well-handled (skip link, ARIA, focus trapping, keyboard nav, reduced motion) |
| FI-03 | UI/UX | Theme system well-structured (localStorage persistence, cross-tab sync, prefers-color-scheme on init) |
| FI-04 | CODE-QUALITY | All page components with timers properly clean up in disconnectedCallback (verified) |
| FI-05 | CODE-QUALITY | 11 of 12 page components exceed 1285 LOC (largest: page-knowledge.js at 3048 LOC) |
| FI-06 | DEPENDENCY | 0 npm audit vulnerabilities, 69 total packages, express 4.x stable (5.x available) |
| FI-07 | DEAD-CODE | 18 modular route files exist but are not mounted — ~4000 LOC of enhanced but unused code |

---

## 3. DEPENDENCY AUDIT

| Package | Current | Latest | Status |
|---------|---------|--------|--------|
| express | 4.22.1 | 5.2.1 | Major upgrade available (not urgent) |
| ws | 8.18.0 | 8.18.0 | Up to date |

- **npm audit**: 0 vulnerabilities
- **Unused deps**: None (only 2 deps, both used)
- **Total packages**: 69 (lean)

---

## 4. BUILD & CONFIG AUDIT

- **Docker**: `docker compose config` validates cleanly
- **Dockerfile**: Valid syntax, node:22-alpine base, healthcheck configured
- **Env vars**: All required vars present in `.env`; inconsistent defaults between inline and modular auth (CRITICAL SC-01)
- **Python files**: All 16 `.py` files pass `py_compile`
- **Shell scripts**: All 4 `oasis-*.sh` pass `bash -n` syntax check
- **Dashboard JS**: All 62 `.js` files pass `node --check`
- **Orphan**: `com.oasis.nightly-import.plist` references missing `scripts/voice/nightly-import.sh`

---

## 5. SUMMARY COUNTS

| Severity | Count |
|----------|-------|
| CRITICAL | 7 |
| HIGH | 13 |
| MEDIUM | 22 |
| LOW | 20 |
| INFO | 13 |
| **Total** | **75** |

Detailed sub-audits: `QA-SERVER-AUDIT.md` and `QA-FRONTEND-AUDIT.md` (same directory).
