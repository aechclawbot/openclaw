# OASIS Dashboard Server QA Audit

**Date**: 2026-02-28
**Scope**: `server.js` (1674 lines) + 21 route modules + 3 middleware + 4 services + 3 utils
**Total files analyzed**: 32

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Route Mounting Analysis](#route-mounting-analysis)
3. [CRITICAL Findings](#critical-findings)
4. [HIGH Findings](#high-findings)
5. [MEDIUM Findings](#medium-findings)
6. [LOW Findings](#low-findings)
7. [INFO Findings](#info-findings)
8. [Environment Variables](#environment-variables)
9. [Complete Endpoint Inventory](#complete-endpoint-inventory)

---

## Architecture Overview

### Inline vs. Modular Routes

**Mounted modular routes (3 of 21):**
- `healthRoutes` -> `app.use("/api", healthRoutes)` -- endpoints: `/api/health`, `/api/system`
- `dockerRoutes` -> `app.use("/api/docker", dockerRoutes)` -- endpoints: `/api/docker/containers`, etc.
- `chatRoutes` -> `app.use("/api/chat", chatRoutes)` -- endpoints: `/api/chat/stream`, `/api/chat/sessions`, etc.

**Imported but NOT mounted (0):**
None -- only `healthRoutes`, `dockerRoutes`, and `chatRoutes` are imported into `server.js`.

**Modular route files that exist but are NOT imported/mounted by server.js (18):**
- `server/routes/agents.js` -- NOT mounted (duplicate inline at `/api/agents`)
- `server/routes/cron.js` -- NOT mounted (duplicate inline at `/api/cron`)
- `server/routes/todos.js` -- NOT mounted (duplicate inline at `/api/todos`)
- `server/routes/settings.js` -- NOT mounted
- `server/routes/voice.js` -- NOT mounted (partial duplicate inline at `/api/voice/*`)
- `server/routes/curator.js` -- NOT mounted (partial duplicate inline at `/api/curator/*`)
- `server/routes/treasury.js` -- NOT mounted (partial duplicate inline at `/api/treasury`)
- `server/routes/spawn.js` -- NOT mounted (no inline equivalent)
- `server/routes/activity.js` -- NOT mounted (duplicate inline at `/api/activity`)
- `server/routes/nolan.js` -- NOT mounted (no inline equivalent)
- `server/routes/aech.js` -- NOT mounted (no inline equivalent)
- `server/routes/dito.js` -- NOT mounted (no inline equivalent)
- `server/routes/preferences.js` -- NOT mounted (no inline equivalent)
- `server/routes/audit.js` -- NOT mounted (partial duplicate inline at `/api/audit/*`)
- `server/routes/recipes.js` -- NOT mounted (partial duplicate inline at `/api/recipes/*`)
- `server/routes/metrics.js` -- NOT mounted (no inline equivalent)
- `server/routes/features.js` -- NOT mounted (no inline equivalent)
- `server/routes/ops.js` -- NOT mounted (partial duplicate inline at `/api/ops/*`)

### Gateway WebSocket Connection Lifecycle

- **RPC calls**: Each `rpcCall()` opens a fresh transient WebSocket, authenticates via challenge-response with `OPENCLAW_GATEWAY_TOKEN`, sends one RPC method, reads response, then closes. Defined in both `server.js` (inline) and `server/services/gateway-client.js` (modular).
- **Monitor connection**: `gateway-client.js` has a persistent monitoring connection with auto-reconnect (exponential backoff, capped at 30s). This is NOT started from `server.js` because `startMonitorConnection()` is never called.
- **Activity poller**: `server.js` runs `setInterval(pollGatewayActivity, 15_000)` that opens transient WS connections every 15 seconds.
- **Dashboard WS**: `DashboardWebSocket` runs on `/ws` with 30s heartbeat interval for dead connection detection.

---

## CRITICAL Findings

### C-01: Hardcoded Default Credentials in Middleware
**File**: `server/middleware/auth.js` (line 8-9)
**File**: `server/routes/health.js` (line 14-15)
```js
const AUTH_USER = process.env.OPENCLAW_DASHBOARD_USERNAME || "oasis";
const AUTH_PASS = process.env.OPENCLAW_DASHBOARD_PASSWORD || "ReadyPlayer@1";
```
Default credentials are hardcoded as fallbacks. If env vars are not set, the dashboard is accessible with known credentials `oasis / ReadyPlayer@1`. The inline `basicAuth` in `server.js` (line 195) correctly disables auth when creds are empty, but the modular middleware and health route have different behavior -- they fall back to known defaults.

**Impact**: Anyone who reads this source code (or this audit) can access the dashboard.

### C-02: Command Injection via Unsanitized User Input in `spawn()`
**Files**: `server/routes/todos.js` (lines 125-130), `server/routes/features.js` (lines 145-150, 220-224), `server/routes/audit.js` (lines 71-83), `server.js` (lines 807-815, 981-989)

User-supplied `todo.title`, `todo.description`, `todo.context`, `feature.title`, `feature.description`, and `feature.plan` are interpolated directly into shell command prompts passed to `claude --print`:
```js
const prompt = `Execute this OASIS task:\n\nTitle: ${todo.title}\n...`;
const child = spawn("claude", ["--dangerously-skip-permissions", "--print", prompt], ...);
```
While `spawn()` with array args avoids shell injection, the `claude` CLI itself may interpret the prompt content in ways that allow arbitrary actions since `--dangerously-skip-permissions` is used. An attacker who can create a todo or feature request can execute arbitrary commands via the Claude Code agent.

**Impact**: Remote code execution via the dashboard API.

### C-03: `--dangerously-skip-permissions` Used Everywhere
**Files**: Every `spawn("claude", ...)` call across todos, features, audit, ops routes.

All Claude Code invocations use `--dangerously-skip-permissions`, meaning the agent can read/write/delete any file and execute any command without user approval. Combined with C-02, this is a full RCE chain.

---

## HIGH Findings

### H-01: Massive Code Duplication Between Inline and Modular Routes
**File**: `server.js` vs. `server/routes/*.js`

The entire set of inline routes in `server.js` (lines 503-1660, ~1150 lines) duplicates functionality that exists in modular route files. Only 3 modular routes are actually mounted. The 18 unmounted route files contain enhanced versions (better validation, mutex-protected file I/O, scan extraction) that are completely dead code.

Specific duplications:
- Agents: inline (line 511) vs. `routes/agents.js` (modular has model change, workspace files, clear-memory)
- Cron: inline (line 530) vs. `routes/cron.js` (modular has CRUD, extract, run history)
- Todos: inline (line 885) vs. `routes/todos.js` (modular has mutex protection, task_number, atomic writes)
- Voice: inline (line 1507) vs. `routes/voice.js` (modular has full pipeline, candidates, profiles)
- Curator: inline (line 676) vs. `routes/curator.js` (modular has tree, insights, write, AI chat)
- Audit: inline (line 1221) vs. `routes/audit.js` (modular has approve/fix workflows)

**Impact**: Bug fixes in modular routes have no effect. Clients hit the inline routes. The inline todo routes lack mutex protection, creating race conditions.

### H-02: Race Conditions in Inline Todo File Operations
**File**: `server.js` (lines 910-1113)

The inline todo routes use `readTodos()` and `writeTodos()` without any mutex. The modular `routes/todos.js` uses `withMutex(TODOS_FILE, ...)` to serialize file operations. Since the inline routes are what actually serve traffic, concurrent requests can cause data loss (read-modify-write race):
```js
app.post("/api/todos", (req, res) => {
  const todos = readTodos();  // Read
  // ... modify
  writeTodos(todos);  // Write -- overwrites concurrent changes
});
```

**Impact**: Concurrent todo operations can silently lose data.

### H-03: Inline Todo `writeTodos()` Is Not Atomic
**File**: `server.js` (line 779-781)
```js
function writeTodos(todos) {
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}
```
Compared to the modular version which uses write-to-temp-then-rename:
```js
async function writeTodos(todos) {
  const tmpFile = TODOS_FILE + ".tmp";
  await writeFile(tmpFile, JSON.stringify(todos, null, 2));
  renameSync(tmpFile, TODOS_FILE);
}
```
If the process crashes mid-write, the inline version corrupts the todos file.

**Impact**: Data corruption on crash.

### H-04: Auth Bypass on `/api/health` Endpoint
**Files**: `server.js` (line 197), `server/middleware/auth.js` (line 38)

The health endpoint is exempt from authentication:
```js
if (req.path === "/api/health") return next();
```
However, the health route at `server/routes/health.js` returns detailed system information (sessions count, agent count, version, node version, platform, arch, Docker status, memory usage, full gateway health data) when authenticated. The unauthenticated response is minimal (`{ status: "ok" }`). This is correct design, but the path exemption uses exact match -- a request to `/api/health?foo=bar` would still bypass auth, and the health handler returns the rich response if auth headers happen to be present.

**Impact**: Information disclosure to monitoring tools that include stale auth headers.

### H-05: Gemini API Key Exposed in URL
**Files**: `server.js` (line 1364), `server/routes/curator.js` (line 275)
```js
const apiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`,
```
The API key is passed as a URL query parameter, which means it appears in server logs, proxy logs, and any intermediate HTTP caches.

**Impact**: API key leakage via logs.

### H-06: Nolan/Aech/Dito Data Files Have No Mutex Protection
**Files**: `server/routes/nolan.js`, `server/routes/aech.js`, `server/routes/dito.js`, `server/services/scan-extractor.js`

All file read/write operations on `projects.json`, `deals.json`, and `pipeline.md` use raw `readFileSync`/`writeFileSync` without mutex. Concurrent requests (or concurrent scan extraction) can corrupt these files.

**Impact**: Data corruption under concurrent access.

### H-07: WebSocket Token Auth Accepts Base64 Credentials in URL
**File**: `server/services/websocket-server.js` (lines 58-67)
```js
validateToken(token) {
  if (!token) return false;
  const decoded = Buffer.from(token, "base64").toString();
  const idx = decoded.indexOf(":");
  return this._validateCredentials(decoded.slice(0, idx), decoded.slice(idx + 1));
}
```
WebSocket connections accept credentials as a `?token=` query parameter containing base64-encoded `user:pass`. This means credentials appear in browser history, server access logs, and proxy logs.

**Impact**: Credential exposure via URL parameters.

---

## MEDIUM Findings

### M-01: Timing-Unsafe Auth in Inline `basicAuth` vs. Safe in Modular
**File**: `server.js` (lines 212-218)

The inline `basicAuth` uses `timingSafeEqual` but has a length check that leaks whether the username/password length matches:
```js
const userOk = userBuf.length === expectUserBuf.length && timingSafeEqual(userBuf, expectUserBuf);
```
The modular `server/middleware/auth.js` uses HMAC-based comparison that prevents length leaks:
```js
function safeCompare(a, b) {
  const hmacA = createHmac("sha256", "dashboard-auth").update(a).digest();
  const hmacB = createHmac("sha256", "dashboard-auth").update(b).digest();
  return timingSafeEqual(hmacA, hmacB);
}
```
Since the inline auth is what actually runs (it is the middleware applied via `app.use(basicAuth)`), the timing-safe improvements in the modular version are dead code.

**Impact**: Minor timing side-channel that reveals credential length.

### M-02: Rate Limit and Security Headers Middleware Not Used
**Files**: `server/middleware/rate-limit.js`, `server/middleware/security-headers.js`

These middlewares exist but are never imported or applied in `server.js`. The application has:
- No rate limiting (beyond the auth failure tracking in the modular middleware, which is also not used)
- No security headers (X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc.)

**Impact**: Vulnerable to brute-force attacks, clickjacking, MIME sniffing attacks.

### M-03: Activity Log Unbounded Growth (In-Memory)
**File**: `server.js` (lines 53-66)

The `activityLog` array is capped at 500 entries, but `prevSessionState` and `prevCronState` objects (lines 69-70) grow indefinitely as new sessions are created and never cleaned up:
```js
let prevSessionState = {};
let prevCronState = {};
```

**Impact**: Slow memory leak proportional to unique session count over time.

### M-04: `since` Parameter in Docker Logs Not Fully Sanitized
**File**: `server/routes/docker.js` (line 246), `server.js` (line 1285)

The modular route sanitizes:
```js
const since = (req.query.since || "").replace(/[^0-9T:.Z-]/g, "");
```
But the inline route does not sanitize at all:
```js
const since = req.query.since || "";
```
The inline route passes unsanitized `since` to the Docker API URL path.

**Impact**: Potential HTTP request smuggling against Docker API.

### M-05: Docker Rebuild Spawns Script with Hardcoded Path
**File**: `server/routes/docker.js` (line 229)
```js
const child = spawn("/Users/oasis/openclaw/scripts/oasis-weekly-update.sh", [], { ... });
```
Hardcoded absolute path to the update script. If the repo moves or runs in a different environment, this silently fails.

**Impact**: Rebuild from dashboard silently fails in non-standard environments.

### M-06: `runOasisOps()` Duplicated 3 Times
**Files**: `server.js` (line 784), `server/routes/todos.js` (line 29), `server/routes/features.js` (line 19)

Three identical copies of the `runOasisOps()` function exist. Bug fixes need to be applied in all three places.

### M-07: Transaction History Cache (`txHistory`) Never Cleaned in `server.js`
**File**: `server.js` (line 48-50)

The inline `cache.txHistory` Map is never cleaned up. Unlike the modular `treasury.js` (which has a `setInterval` cleanup every 10 minutes), entries accumulate indefinitely.

**Impact**: Slow memory leak from cached transaction data.

### M-08: Scheduler Polls Reads Todos File Every 60 Seconds (Both Inline and Modular)
**Files**: `server.js` (line 859), `server/routes/todos.js` (line 192)

Both the inline and modular scheduler pollers run `setInterval` every 60 seconds. If both were somehow loaded, tasks would execute twice. Currently only the inline one runs. However, the poller reads the entire todos file from disk every minute even when there are no scheduled tasks.

**Impact**: Unnecessary I/O. Potential double-execution if modular routes are ever mounted.

### M-09: No Input Sanitization on Audit Findings
**File**: `server.js` (lines 1251-1280), `server/routes/audit.js`

The `generate-tasks` endpoint accepts arbitrary findings and creates todos from them. The `title` field is substring'd to 500 chars but otherwise unsanitized. Combined with C-02, injected findings could become executable task titles.

### M-10: Missing AbortController in Inline Treasury/Blockchain Fetch Calls
**File**: `server.js` (lines 376-501)

The inline treasury functions (`getEthPrice`, `getEthBalance`, `getUsdcBalance`, `getTransactions`) use bare `fetch()` without timeout signals. If an RPC endpoint hangs, the request hangs forever.

The modular `server/routes/treasury.js` correctly uses `AbortSignal.timeout(FETCH_TIMEOUT_MS)`.

**Impact**: Potential request hangs that consume server resources.

### M-11: Monitor Connection Not Started
**File**: `server/services/gateway-client.js` (line 223)

`startMonitorConnection()` is exported but never called from `server.js`. The persistent gateway monitor with auto-reconnect and event subscription is dead code.

### M-12: Two Duplicate `rpcCall` Implementations
**Files**: `server.js` (line 228), `server/services/gateway-client.js` (line 24)

Two separate `rpcCall` implementations exist. The inline routes use the one in `server.js`; the modular routes import from `gateway-client.js`. They have slightly different client IDs (`gateway-client` vs `openclaw-control-ui`) and the modular version includes origin header handling.

---

## LOW Findings

### L-01: `console.log` Statements in Production Code
**Files**: Throughout all files.

Excessive console logging in production:
- `server/services/websocket-server.js`: logs every connect/disconnect
- `server.js` line 185: "Activity poller seeded"
- `server/services/gateway-client.js` line 183: "Gateway monitor connected successfully"
- `server/routes/docker.js`: broadcasts to global WS

**Impact**: Log noise, minor performance impact.

### L-02: `readJsonFile` Helper Duplicated 6 Times
**Files**: `server.js`, `server/routes/agents.js`, `server/routes/cron.js`, `server/routes/todos.js`, `server/routes/settings.js`, `server/routes/spawn.js`

Each file defines its own `readJsonFile()` helper with identical logic.

### L-03: `logActivity` Helper Duplicated 9 Times
**Files**: `server.js`, `server/routes/agents.js`, `server/routes/cron.js`, `server/routes/todos.js`, `server/routes/settings.js`, `server/routes/docker.js`, `server/routes/nolan.js`, `server/routes/aech.js`, `server/routes/dito.js`

Some use the global array, some use `global.dashboardWs.broadcast()` directly. Behavior differs between them.

### L-04: Inline Audio Route Has Strict Filename Regex
**File**: `server.js` (line 1630)
```js
if (!/^recording_\d{8}_\d{6}\.wav$/.test(filename))
```
But the modular voice route (line 580) uses a more permissive pattern:
```js
if (!/^[a-zA-Z0-9_.-]+$/.test(filename))
```
The inline version rejects valid audio files with non-`recording_` prefixes (e.g., `boosted_` files).

### L-05: Feature Requests File Uses `$HOME/.openclaw/` While Audit Uses `CONFIG_DIR`
**File**: `server/routes/features.js` (line 13)
```js
const FEATURES_FILE = join(process.env.HOME || "/root", ".openclaw", "feature-requests.json");
```
**File**: `server/routes/audit.js` (line 13)
```js
const AUDIT_REPORTS_DIR = join(process.env.HOME || "/root", ".openclaw", "audit-reports");
```
These use `HOME` while most other routes use `CONFIG_DIR`. In Docker, `CONFIG_DIR=/config` but `HOME` may be `/root`, causing data to be stored in different locations.

### L-06: Dito Lead Updates Use Array Index as ID
**File**: `server/routes/dito.js` (lines 95-110)

Leads are identified by array index in PATCH/DELETE operations. If leads are added or removed concurrently, the index shifts and the wrong lead is modified.

### L-07: CSP in Security Headers Allows `unsafe-inline`
**File**: `server/middleware/security-headers.js` (lines 15-16)
```js
"script-src 'self' 'unsafe-inline'",
"style-src 'self' 'unsafe-inline'",
```
This weakens XSS protection. (Note: this middleware is not even applied -- see M-02.)

### L-08: Missing `req.on("close")` Cleanup for SSE Streams
**File**: `server/routes/chat.js` (line 17)

The chat SSE stream does not clean up the `warningTimer` or abort the RPC call if the client disconnects early. The modular curator chat correctly uses `req.on("close", () => abortController.abort())`.

### L-09: Error Response in Inline Cron Fallback Uses Wrong Variable
**File**: `server.js` (line 568)
```js
} catch {
  res.status(500).json({ error: err.message });
}
```
The inner catch block references `err` from the outer catch scope, not the inner catch. While this works in JS (outer `err` is in scope), it returns the RPC error message instead of the file read error message.

### L-10: `parseDockerLogs` Duplicated
**Files**: `server.js` (line 350), `server/utils/docker-client.js` (line 79)

Two identical implementations of Docker log parsing.

### L-11: `dockerRequest` Duplicated
**Files**: `server.js` (line 309), `server/utils/docker-client.js` (line 61)

Two implementations of Docker API requests. The inline version lacks Content-Type header.

---

## INFO Findings

### I-01: File Size and Complexity
- `server.js`: 1674 lines -- far exceeds the 500-700 LOC guideline. Most content is duplicated inline routes.
- `server/routes/voice.js`: 964 lines -- complex but well-structured.
- `server/routes/recipes.js`: 405 lines -- reasonable.
- `server/routes/settings.js`: 510 lines -- at the upper bound.

### I-02: Wallet Addresses Defined in Multiple Places
- `server.js` (lines 31-42): 2 wallets (aech, nolan)
- `server/routes/treasury.js` (lines 39-43): 3 wallets (aech, nolan, oasis)
- `server/services/treasury-service.js` (lines 34-38): 3 wallets (aech, nolan, oasis)

The inline version is missing the "oasis" wallet.

### I-03: Feature Progress Stream Supports Only One SSE Client
**File**: `server/routes/features.js` (line 302)
```js
entry.res = res;  // Overwrites previous client
```
If two clients subscribe to the same feature's progress, the first client stops receiving updates.

### I-04: No CORS Configuration
The server has no CORS middleware. This is acceptable if the dashboard is only accessed directly (not via cross-origin XHR), but limits API integration options.

### I-05: `express.json()` Applied After `express.static()`
**File**: `server.js` (lines 224-225)
```js
app.use(express.static("public"));
app.use(express.json());
```
This is fine but means JSON body parsing runs even for static file requests (no-op).

### I-06: No Request Size Limits
`express.json()` is used without a `limit` option. The default is 100KB, which is reasonable. But endpoints like `PATCH /api/todos/:id` accept `execution_report` fields up to 100KB in the body while storing up to 100KB in the file, potentially leading to large payloads.

### I-07: Modular Treasury Has Cache Cleanup Interval
**File**: `server/routes/treasury.js` (line 205)
```js
setInterval(() => { ... }, 600_000);
```
This interval runs at module load time even though the module is not imported. It would only start if the module were ever imported.

---

## Environment Variables

| Variable | Used In | Default | Required |
|---|---|---|---|
| `DASHBOARD_PORT` | server.js | `3000` | No |
| `GATEWAY_URL` | server.js, gateway-client.js | `ws://oasis:18789` | No |
| `OPENCLAW_GATEWAY_TOKEN` | server.js, gateway-client.js | `""` (empty) | Yes (auth fails without it) |
| `OPENCLAW_CONFIG_DIR` | Many files | `/config` | No |
| `GATEWAY_CONTAINER` | server.js, health.js | `oasis` | No |
| `DOCKER_SOCK` | server.js, docker-client.js | `/var/run/docker.sock` | No |
| `DOCKER_HOST` | server.js, docker-client.js | `""` | No (one of DOCKER_SOCK or DOCKER_HOST needed) |
| `OPENCLAW_DASHBOARD_USERNAME` | server.js, auth.js, health.js | `""` / `"oasis"` | Mixed defaults |
| `OPENCLAW_DASHBOARD_PASSWORD` | server.js, auth.js, health.js | `""` / `"ReadyPlayer@1"` | Mixed defaults |
| `GEMINI_API_KEY` | server.js, curator.js | `""` | For curator AI chat |
| `AUDIO_DIR` | voice.js | `~/oasis-audio/inbox` | No |
| `AUDIO_DONE_DIR` | voice.js, server.js | `/audio/done` / `~/oasis-audio/done` | No |
| `AUDIO_INBOX_DIR` | server.js, voice.js | `/audio/inbox` | No |
| `AUDIO_LISTENER_URL` | server.js | `http://audio-listener:9001` | No |
| `HOME` | todos.js, features.js, audit.js | `/root` | No |
| `BASE_API_KEY` / `ETHEREUM_API_KEY` / `POLYGON_API_KEY` | treasury-service.js | `""` | For block explorer API |

**Inconsistency**: `OPENCLAW_DASHBOARD_USERNAME` defaults to empty string in `server.js` (line 21) which disables auth, but defaults to `"oasis"` in `server/middleware/auth.js` (line 8) and `server/routes/health.js` (line 14). This means the inline auth in server.js may skip auth while the modular middleware (if ever applied) would use hardcoded defaults.

---

## Complete Endpoint Inventory

### Inline Routes (server.js) -- ACTIVE

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Gateway health (via mounted module) |
| GET | `/api/system` | System info (via mounted module) |
| GET | `/api/docker/containers` | List Docker containers (via mounted module) |
| POST | `/api/docker/containers/:name/stop` | Stop container (via mounted module) |
| POST | `/api/docker/containers/:name/start` | Start container (via mounted module) |
| POST | `/api/docker/containers/:name/restart` | Restart container (via mounted module) |
| POST | `/api/docker/restart-all` | Restart all containers (via mounted module) |
| POST | `/api/docker/rebuild` | Trigger rebuild (via mounted module) |
| GET | `/api/docker/logs/:containerName` | Container logs (via mounted module) |
| POST | `/api/chat/stream` | SSE chat streaming (via mounted module) |
| GET | `/api/chat/sessions` | List chat sessions (via mounted module) |
| GET | `/api/chat/sessions/:id` | Session messages (via mounted module) |
| POST | `/api/chat/sessions` | Create session (via mounted module) |
| GET | `/api/agents` | List agents |
| GET | `/api/cron` | List cron jobs |
| POST | `/api/cron/:jobId/toggle` | Toggle cron job |
| POST | `/api/cron/:jobId/run` | Trigger cron job |
| GET | `/api/cron/:jobId/runs` | Cron run history |
| GET | `/api/sessions` | List gateway sessions |
| POST | `/api/agents/:agentId/message` | Send message to agent |
| GET | `/api/treasury` | Treasury balances |
| GET | `/api/treasury/:address/transactions` | Transaction history |
| GET | `/api/curator/search` | Search knowledge base |
| GET | `/api/curator/file` | Read curator file |
| POST | `/api/curator/chat` | AI chat via Gemini (SSE) |
| GET | `/api/activity` | Activity feed |
| GET | `/api/todos` | List todos |
| GET | `/api/todos/:id/details` | Todo details |
| POST | `/api/todos` | Create todo |
| PATCH | `/api/todos/:id` | Update todo |
| POST | `/api/todos/:id/plan` | Generate execution plan |
| GET | `/api/todos/:id/plan-progress` | Poll planning progress |
| POST | `/api/todos/:id/approve` | Approve/reject plan |
| POST | `/api/todos/:id/replan` | Discard plan |
| POST | `/api/todos/:id/execute` | Execute todo |
| GET | `/api/todos/:id/progress` | Execution progress |
| DELETE | `/api/todos/:id` | Delete todo |
| POST | `/api/ops/trigger` | Trigger ops check |
| GET | `/api/ops/status` | Ops check status |
| POST | `/api/audit/qa/trigger` | Trigger QA audit |
| GET | `/api/audit/qa/status` | QA audit status |
| GET | `/api/audit/qa/reports` | QA audit reports |
| POST | `/api/audit/security/trigger` | Trigger security audit |
| GET | `/api/audit/security/status` | Security audit status |
| GET | `/api/audit/security/reports` | Security audit reports |
| POST | `/api/audit/:type/generate-tasks` | Generate tasks from findings |
| GET | `/api/logs/gateway` | Gateway container logs |
| GET | `/api/recipes/weeks` | List recipe weeks |
| GET | `/api/recipes/:week` | Week's meals |
| GET | `/api/recipes/:week/:day` | Day's recipe |
| GET | `/api/voice/stats` | Voice pipeline stats |
| GET | `/api/voice/transcripts` | List transcripts |
| GET | `/api/voice/audio/:filename` | Serve audio file |
| POST | `/api/voice/reidentify` | Trigger re-identification |

### Modular Routes (NOT mounted) -- DEAD CODE

| Module | Would-be Mount | Key Endpoints |
|---|---|---|
| `agents.js` | `/api/agents` | GET /, GET /:id, PUT /:id/model, POST /:id/message, POST /:id/clear-memory, GET/PUT /:id/workspace/files/:filename |
| `cron.js` | `/api/cron` | GET /, GET /:jobId/details, POST /, PUT /:jobId, DELETE /:jobId, POST /:jobId/toggle, POST /:jobId/run, GET /:jobId/runs, POST /:jobId/extract |
| `todos.js` | `/api/todos` | Full CRUD + plan/approve/execute/schedule with mutex |
| `settings.js` | `/api/settings` | GET/POST /settings, GET /models, GET/PUT /bindings, GET/PATCH /channels/:id, POST /settings/plugins/:pluginId, GET /usage, GET /sessions, GET /sessions/:key/transcript, POST /sessions/:key/reset, DELETE /sessions/:key |
| `voice.js` | `/api/voice` | Transcripts CRUD, speaker labeling, retry, candidates approve/reject, profiles CRUD, audio serving, stats, pipeline status, conversations |
| `curator.js` | `/api/curator` | Stats, search, file read/write, tree, AI chat (SSE), insights |
| `treasury.js` | `/api/treasury` | Legacy + v2 multi-chain, portfolio summary, wallet details, transactions, cache clear |
| `spawn.js` | `/api/spawn` | Validate ID, templates, create agent |
| `activity.js` | `/api/activity` | List activity |
| `nolan.js` | `/api/nolan` | Projects CRUD |
| `aech.js` | `/api/aech` | Deals CRUD |
| `dito.js` | `/api/dito` | Pipeline view, leads CRUD, demos list |
| `preferences.js` | `/api/preferences` | Preference categories CRUD |
| `audit.js` | `/api/audit` | QA + security audit with approve/fix workflows |
| `recipes.js` | `/api/recipes` | Full recipe management: weeks, days, shopping lists, feedback, refresh |
| `metrics.js` | `/api/metrics` | Summary, agents, cron, system metrics |
| `features.js` | `/api/features` | Feature requests CRUD + plan/approve/execute with SSE progress |
| `ops.js` | `/api/ops` | Trigger + status ops check |

---

## Recommendations (Priority Order)

1. **Mount all modular routes and remove inline duplicates** from `server.js`. This is the single highest-impact change -- it activates mutex-protected file I/O, better validation, and ~18 entire feature sets.

2. **Remove hardcoded default credentials**. Change fallback to empty string everywhere, which correctly disables auth (with a warning).

3. **Apply rate-limit and security-headers middleware** by importing and using them in `server.js`.

4. **Add input sanitization** for text that flows into `claude --print` prompts. At minimum, limit length and strip control characters.

5. **Consolidate duplicate helpers** (`readJsonFile`, `logActivity`, `rpcCall`, `runOasisOps`, `parseDockerLogs`, `dockerRequest`) into shared modules.

6. **Add AbortSignal timeouts** to all `fetch()` calls in the inline treasury code.

7. **Clean up `prevSessionState`/`prevCronState`** periodically to prevent unbounded growth.

8. **Start the gateway monitor connection** if event subscriptions are desired, or remove the dead code.

9. **Move Gemini API key** to a request header instead of URL query parameter.

10. **Add request body size limits** for endpoints that accept large payloads.
