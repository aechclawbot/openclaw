import { randomUUID, timingSafeEqual, createHmac } from "crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import http from "http";
import { join, resolve } from "path";
import express from "express";
import { WebSocket } from "ws";
import { spawn } from "child_process";
import { DashboardWebSocket } from "./server/services/websocket-server.js";
import healthRoutes from "./server/routes/health.js";
import dockerRoutes from "./server/routes/docker.js";
import chatRoutes from "./server/routes/chat.js";
import curatorRoutes from "./server/routes/curator.js";
import voiceRoutes from "./server/routes/voice.js";
import ditoRoutes from "./server/routes/dito.js";
import nolanRoutes from "./server/routes/nolan.js";
import aechRoutes from "./server/routes/aech.js";
import treasuryModularRoutes from "./server/routes/treasury.js";
import agentsRoutes from "./server/routes/agents.js";
import featuresRoutes from "./server/routes/features.js";
import metricsRoutes from "./server/routes/metrics.js";
import settingsRoutes from "./server/routes/settings.js";
import preferencesRoutes from "./server/routes/preferences.js";
import spawnRoutes from "./server/routes/spawn.js";
import recipesRoutes from "./server/routes/recipes.js";
import cronModularRoutes from "./server/routes/cron.js";
import auditModularRoutes from "./server/routes/audit.js";
import opsRoutes from "./server/routes/ops.js";
import { securityHeaders } from "./server/middleware/security-headers.js";
import { rateLimit } from "./server/middleware/rate-limit.js";
import { sanitizePromptInput, sanitizeDockerParam } from "./server/utils/sanitize.js";

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;
const GATEWAY_WS = process.env.GATEWAY_URL || "ws://oasis:18789";
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const GATEWAY_CONTAINER = process.env.GATEWAY_CONTAINER || "oasis";
const DOCKER_SOCK = process.env.DOCKER_SOCK || "/var/run/docker.sock";
const DOCKER_HOST = process.env.DOCKER_HOST || "";
const AUTH_USER = process.env.OPENCLAW_DASHBOARD_USERNAME || "";
const AUTH_PASS = process.env.OPENCLAW_DASHBOARD_PASSWORD || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const TODOS_FILE = join(CONFIG_DIR, "dashboard-todos.json");

// --- Chain Config ---
const BASE_RPC = "https://mainnet.base.org";
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BLOCKSCOUT_API = "https://base.blockscout.com/api/v2";

const WALLETS = {
  aech: {
    address: "0xd337fe9Df3fdFaf053786874074D8D9960993867",
    name: "Aech",
    emoji: "\u26a1",
  },
  nolan: {
    address: "0x2E566F6BA5f1fA38Aed50f2d1ea4E39F0689a6e4",
    name: "Nolan",
    emoji: "\ud83c\udf96\ufe0f",
  },
};

// --- Caches ---
const cache = {
  treasury: { data: null, ts: 0, ttl: 60_000 },
  ethPrice: { data: null, ts: 0, ttl: 120_000 },
  txHistory: new Map(),
};
const TX_CACHE_TTL = 300_000;

// --- Activity Log ---
const activityLog = [];
const MAX_ACTIVITY = 500;

function logActivity(type, agent, message, details = {}) {
  activityLog.unshift({
    id: randomUUID(),
    ts: Date.now(),
    type,
    agent,
    message,
    ...details,
  });
  if (activityLog.length > MAX_ACTIVITY) {activityLog.length = MAX_ACTIVITY;}
}

// --- Activity Poller (real gateway events) ---
let prevSessionState = {};
let prevCronState = {};
let pollerStarted = false;

// Periodic cleanup: prune stale entries from prev* caches and txHistory (every 10 min)
setInterval(() => {
  const cutoff = Date.now() - 86_400_000; // 24 hours
  for (const [key, val] of Object.entries(prevSessionState)) {
    if ((val.updatedAt || 0) < cutoff) {delete prevSessionState[key];}
  }
  for (const [key, val] of Object.entries(prevCronState)) {
    if ((val.updatedAt || val.ts || 0) < cutoff) {delete prevCronState[key];}
  }
  const txCutoff = Date.now() - TX_CACHE_TTL;
  for (const [key, entry] of cache.txHistory) {
    if ((entry.ts || 0) < txCutoff) {cache.txHistory.delete(key);}
  }
}, 600_000);

async function pollGatewayActivity() {
  try {
    // Poll sessions
    const sessResult = await rpcCall("sessions.list", {
      limit: 100,
      activeMinutes: 1440,
      includeLastMessage: true,
      includeDerivedTitles: true,
    }).catch(() => null);

    if (sessResult?.sessions) {
      const sessions = Array.isArray(sessResult.sessions) ? sessResult.sessions : [];
      for (const s of sessions) {
        const key = s.key || s.id || "";
        const updatedAt = s.updatedAt || 0;
        const prev = prevSessionState[key];

        if (!prev) {
          // New session detected
          const m = key.match(/^agent:([^:]+)/);
          const agentId = m ? m[1] : s.agentId || "unknown";
          const isCron = key.includes(":cron:");
          const isSubagent = key.includes(":subagent:");
          let msg;
          if (isCron) {
            const cronMatch = key.match(/:cron:([^:]+)/);
            msg = `Cron session started: ${cronMatch ? cronMatch[1] : key}`;
          } else if (isSubagent) {
            msg = `Subagent session spawned`;
          } else if (key.endsWith(":main")) {
            msg = `Main session active`;
          } else {
            msg = `Session started: ${key.split(":").slice(-1)[0]}`;
          }
          // Only log if session is recent (within last 2 min)
          if (Date.now() - updatedAt < 120_000) {
            logActivity("session", agentId, msg);
          }
        } else if (updatedAt > prev.updatedAt) {
          // Session updated
          const m = key.match(/^agent:([^:]+)/);
          const agentId = m ? m[1] : s.agentId || "unknown";
          const timeDiff = updatedAt - prev.updatedAt;
          // Only log significant updates (>10s gap to avoid noise)
          if (timeDiff > 10_000) {
            const ch = s.channel ? ` via ${s.channel}` : "";
            const lastMsg =
              s.lastMessage?.text?.substring(0, 80) || s.lastMessage?.content?.substring(0, 80);
            const msg = lastMsg
              ? `Activity${ch}: "${lastMsg}${lastMsg.length >= 80 ? "..." : ""}"`
              : `Session activity${ch}`;
            logActivity("session", agentId, msg);
          }
        }
        prevSessionState[key] = { updatedAt };
      }
    }

    // Poll cron
    const cronResult = await rpcCall("cron.list", {
      includeDisabled: true,
    }).catch(() => null);

    if (cronResult?.jobs) {
      for (const j of cronResult.jobs) {
        const prev = prevCronState[j.id];
        const lastRunAtMs = j.state?.lastRunAtMs || 0;
        const lastStatus = j.state?.lastStatus || "never";

        if (prev && lastRunAtMs > prev.lastRunAtMs) {
          // Cron job ran since last poll
          const dur = j.state?.lastDurationMs
            ? ` (${(j.state.lastDurationMs / 1000).toFixed(1)}s)`
            : "";
          const statusEmoji = lastStatus === "ok" ? "completed" : "failed";
          logActivity("cron_run", j.agentId, `${j.name} ${statusEmoji}${dur}`);
        }
        prevCronState[j.id] = { lastRunAtMs, lastStatus };
      }
    }
  } catch (e) {
    // Silent — don't crash the poller
  }
}

function startActivityPoller() {
  if (pollerStarted) {return;}
  pollerStarted = true;
  // Initial seed (populate state without logging old events)
  (async () => {
    try {
      const sess = await rpcCall("sessions.list", {
        limit: 100,
        activeMinutes: 1440,
      }).catch(() => null);
      if (sess?.sessions) {
        for (const s of Array.isArray(sess.sessions) ? sess.sessions : []) {
          const key = s.key || s.id || "";
          prevSessionState[key] = { updatedAt: s.updatedAt || 0 };
        }
      }
      const cron = await rpcCall("cron.list", {
        includeDisabled: true,
      }).catch(() => null);
      if (cron?.jobs) {
        for (const j of cron.jobs) {
          prevCronState[j.id] = {
            lastRunAtMs: j.state?.lastRunAtMs || 0,
            lastStatus: j.state?.lastStatus || "never",
          };
        }
      }
      console.log(
        `Activity poller seeded: ${Object.keys(prevSessionState).length} sessions, ${Object.keys(prevCronState).length} cron jobs`,
      );
    } catch {}
  })();
  setInterval(pollGatewayActivity, 15_000);
}

// --- Basic Auth Middleware (HMAC-based constant-time comparison) ---
function safeCompare(a, b) {
  const hmacA = createHmac("sha256", "dashboard-auth").update(a).digest();
  const hmacB = createHmac("sha256", "dashboard-auth").update(b).digest();
  return timingSafeEqual(hmacA, hmacB);
}

function basicAuth(req, res, next) {
  if (!AUTH_USER || !AUTH_PASS) {return next();}
  // Exempt health endpoint for Docker healthchecks
  if (req.path === "/api/health") {return next();}
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
    return res.status(401).send("Authentication required");
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const idx = decoded.indexOf(":");
  if (idx < 0) {
    res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
    return res.status(401).send("Authentication required");
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (safeCompare(user, AUTH_USER) && safeCompare(pass, AUTH_PASS)) {return next();}
  res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
  return res.status(401).send("Invalid credentials");
}

app.use(securityHeaders);
app.use(rateLimit);
app.use(basicAuth);
app.use(express.static("public"));
app.use(express.json());

// --- Gateway WS RPC ---
function rpcCall(method, params = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const origin = GATEWAY_WS.replace("ws://", "http://").replace("wss://", "https://");
    const ws = new WebSocket(GATEWAY_WS, { headers: { origin } });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("RPC timeout"));
    }, timeoutMs);

    let authenticated = false;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "event" && msg.event === "connect.challenge") {
          ws.send(
            JSON.stringify({
              type: "req",
              id: randomUUID(),
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: "openclaw-control-ui",
                  version: "3.0.0",
                  platform: "node",
                  mode: "backend",
                },
                role: "operator",
                scopes: ["operator.admin"],
                auth: { token: TOKEN },
              },
            }),
          );
          return;
        }

        if (msg.type === "res" && !authenticated) {
          if (msg.error) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(msg.error.message || "Auth failed"));
            return;
          }
          authenticated = true;
          ws.send(JSON.stringify({ type: "req", id: randomUUID(), method, params }));
          return;
        }

        if (msg.type === "res" && authenticated) {
          clearTimeout(timeout);
          if (msg.error) {reject(new Error(msg.error.message || JSON.stringify(msg.error)));}
          else {resolve(msg.result ?? msg.payload ?? null);}
          ws.close();
          return;
        }
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
        ws.close();
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function readJsonFile(path) {
  try {
    if (!existsSync(path)) {return null;}
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// --- Docker API (for gateway logs) ---
function dockerRequest(path) {
  return new Promise((resolve, reject) => {
    let options;
    if (DOCKER_HOST) {
      // TCP connection to Docker socket proxy
      const url = new URL(DOCKER_HOST);
      options = {
        hostname: url.hostname,
        port: parseInt(url.port, 10) || 2375,
        path,
        method: "GET",
        headers: { Host: "localhost" },
      };
    } else if (existsSync(DOCKER_SOCK)) {
      options = {
        socketPath: DOCKER_SOCK,
        path,
        method: "GET",
        headers: { Host: "localhost" },
      };
    } else {
      reject(new Error("No Docker connection available (set DOCKER_HOST or mount docker.sock)"));
      return;
    }
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode, body: buf });
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error("Docker API timeout"));
    });
    req.end();
  });
}

function parseDockerLogs(buf) {
  // Docker multiplexed log format: 8-byte header per frame
  // byte 0: stream (1=stdout, 2=stderr), bytes 4-7: payload size (big-endian)
  const lines = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const streamType = buf[offset]; // 1=stdout, 2=stderr
    const size =
      (buf[offset + 4] << 24) | (buf[offset + 5] << 16) | (buf[offset + 6] << 8) | buf[offset + 7];
    offset += 8;
    if (offset + size > buf.length) {break;}
    const payload = buf.subarray(offset, offset + size).toString("utf-8");
    offset += size;
    // Split payload into individual lines
    const payloadLines = payload.split("\n").filter((l) => l.length > 0);
    for (const line of payloadLines) {
      lines.push({
        stream: streamType === 2 ? "stderr" : "stdout",
        text: line,
      });
    }
  }
  return lines;
}

// --- Treasury Helpers ---
async function getEthPrice() {
  if (cache.ethPrice.data && Date.now() - cache.ethPrice.ts < cache.ethPrice.ttl)
    {return cache.ethPrice.data;}
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(10_000) },
    );
    const data = await res.json();
    cache.ethPrice.data = data.ethereum.usd;
    cache.ethPrice.ts = Date.now();
    return cache.ethPrice.data;
  } catch {
    return cache.ethPrice.data || 0;
  }
}

async function getEthBalance(address) {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    }),
  });
  const data = await res.json();
  return parseInt(data.result, 16) / 1e18;
}

async function getUsdcBalance(address) {
  const selector = "0x70a08231";
  const paddedAddr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: USDC_CONTRACT, data: selector + paddedAddr }, "latest"],
      id: 1,
    }),
  });
  const data = await res.json();
  return parseInt(data.result, 16) / 1e6;
}

async function getTreasuryData() {
  if (cache.treasury.data && Date.now() - cache.treasury.ts < cache.treasury.ttl)
    {return cache.treasury.data;}

  const ethPrice = await getEthPrice();
  const results = {};
  for (const [id, wallet] of Object.entries(WALLETS)) {
    const [eth, usdc] = await Promise.all([
      getEthBalance(wallet.address),
      getUsdcBalance(wallet.address),
    ]);
    results[id] = {
      ...wallet,
      eth: parseFloat(eth.toFixed(6)),
      usdc: parseFloat(usdc.toFixed(2)),
      ethUsd: parseFloat((eth * ethPrice).toFixed(2)),
      totalUsd: parseFloat((eth * ethPrice + usdc).toFixed(2)),
    };
  }
  const data = {
    wallets: results,
    ethPrice: parseFloat(ethPrice.toFixed(2)),
    totalUsd: parseFloat(
      Object.values(results)
        .reduce((s, w) => s + w.totalUsd, 0)
        .toFixed(2),
    ),
  };
  cache.treasury.data = data;
  cache.treasury.ts = Date.now();
  return data;
}

async function getTransactions(address) {
  const key = address.toLowerCase();
  const cached = cache.txHistory.get(key);
  if (cached && Date.now() - cached.ts < TX_CACHE_TTL) {return cached.data;}

  const [txRes, tokenRes] = await Promise.all([
    fetch(`${BLOCKSCOUT_API}/addresses/${address}/transactions`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${BLOCKSCOUT_API}/addresses/${address}/token-transfers`, { signal: AbortSignal.timeout(10_000) }),
  ]);
  const [txData, tokenData] = await Promise.all([txRes.json(), tokenRes.json()]);

  const normal = (txData.items || []).map((tx) => {
    const from = tx.from?.hash || "";
    const to = tx.to?.hash || "";
    return {
      hash: tx.hash,
      from,
      to,
      value: parseFloat((parseInt(tx.value || "0") / 1e18).toFixed(8)),
      symbol: "ETH",
      timestamp: new Date(tx.timestamp).getTime(),
      direction: from.toLowerCase() === key ? "out" : "in",
    };
  });

  const tokens = (tokenData.items || []).map((tx) => {
    const total = tx.total || {};
    const decimals = parseInt(total.decimals || tx.token?.decimals || "18");
    const from = tx.from?.hash || "";
    const to = tx.to?.hash || "";
    return {
      hash: tx.transaction_hash || tx.hash || "",
      from,
      to,
      value: parseFloat((parseInt(total.value || "0") / Math.pow(10, decimals)).toFixed(8)),
      symbol: tx.token?.symbol || "TOKEN",
      timestamp: new Date(tx.timestamp).getTime(),
      direction: from.toLowerCase() === key ? "out" : "in",
    };
  });

  const merged = [...normal, ...tokens].toSorted((a, b) => b.timestamp - a.timestamp).slice(0, 30);
  cache.txHistory.set(key, { data: merged, ts: Date.now() });
  return merged;
}

// =========== API Routes ===========

// Modular routes (v3) — take priority over inline routes
app.use("/api", healthRoutes);
app.use("/api/docker", dockerRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/dito", ditoRoutes);
app.use("/api/nolan", nolanRoutes);
app.use("/api/aech", aechRoutes);
app.use("/api/treasury", treasuryModularRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/features", featuresRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api", settingsRoutes);
app.use("/api/preferences", preferencesRoutes);
app.use("/api/spawn", spawnRoutes);
app.use("/api/recipes", recipesRoutes);

// Cron list
app.get("/api/cron", async (_req, res) => {
  try {
    const result = await rpcCall("cron.list", { includeDisabled: true });
    const summary = (result.jobs || []).map((j) => ({
      id: j.id,
      name: j.name,
      agentId: j.agentId,
      enabled: j.enabled,
      schedule: j.schedule?.expr,
      tz: j.schedule?.tz,
      lastStatus: j.state?.lastStatus || "never",
      lastRunAt: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : null,
      nextRunAt: j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toISOString() : null,
      lastDurationMs: j.state?.lastDurationMs || null,
      consecutiveErrors: j.state?.consecutiveErrors || 0,
      lastError: j.state?.lastError || null,
    }));
    res.json({ jobs: summary });
  } catch (err) {
    try {
      const jobs = readJsonFile(join(CONFIG_DIR, "cron", "jobs.json"));
      if (!jobs) {return res.json({ jobs: [] });}
      const summary = (jobs.jobs || []).map((j) => ({
        id: j.id,
        name: j.name,
        agentId: j.agentId,
        enabled: j.enabled,
        schedule: j.schedule?.expr,
        tz: j.schedule?.tz,
        lastStatus: j.state?.lastStatus || "never",
        lastRunAt: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : null,
        nextRunAt: j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toISOString() : null,
        lastDurationMs: j.state?.lastDurationMs || null,
        consecutiveErrors: j.state?.consecutiveErrors || 0,
        lastError: j.state?.lastError || null,
      }));
      res.json({ jobs: summary });
    } catch (readErr) {
      res.status(500).json({ error: readErr.message });
    }
  }
});

// Cron toggle
app.post("/api/cron/:jobId/toggle", async (req, res) => {
  try {
    const list = await rpcCall("cron.list", { includeDisabled: true });
    const job = (list.jobs || []).find((j) => j.id === req.params.jobId);
    if (!job) {return res.status(404).json({ error: "Job not found" });}
    const newEnabled = !job.enabled;
    await rpcCall("cron.update", {
      jobId: req.params.jobId,
      patch: { enabled: newEnabled },
    });
    logActivity("cron_toggle", job.agentId, `${job.name} ${newEnabled ? "enabled" : "disabled"}`);
    res.json({ ok: true, enabled: newEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cron trigger
app.post("/api/cron/:jobId/run", async (req, res) => {
  try {
    const result = await rpcCall("cron.run", { jobId: req.params.jobId, mode: "force" }, 30_000);
    logActivity("cron_run", null, `Manually triggered ${req.params.jobId}`);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cron run history
app.get("/api/cron/:jobId/runs", async (req, res) => {
  try {
    const result = await rpcCall("cron.runs", {
      jobId: req.params.jobId,
      limit: parseInt(req.query.limit) || 20,
    });
    res.json(result);
  } catch (err) {
    // Fallback: read JSONL run log directly from disk
    try {
      const jobId = req.params.jobId;
      if (!jobId || /[/\\]/.test(jobId)) {return res.status(400).json({ error: "invalid jobId" });}
      const logPath = join(CONFIG_DIR, "cron", "runs", `${jobId}.jsonl`);
      if (!existsSync(logPath)) {return res.json({ entries: [] });}
      const limit = parseInt(req.query.limit) || 20;
      const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
      const entries = [];
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        try { entries.push(JSON.parse(lines[i])); } catch {}
      }
      return res.json({ entries });
    } catch (readErr) {
      res.status(500).json({ error: err.message });
    }
  }
});

// Treasury balances and transactions handled by modular treasury routes (mounted above)

// Curator search
app.get("/api/curator/search", async (req, res) => {
  const query = (req.query.q || "").toLowerCase().trim();
  if (!query) {return res.json({ results: [] });}

  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator");
    const results = [];

    function searchDir(dir, relPath = "") {
      if (!existsSync(dir)) {return;}
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) {continue;}
        const fullPath = join(dir, entry.name);
        const rel = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          searchDir(fullPath, rel);
        } else if (/\.(md|txt|json)$/i.test(entry.name)) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            if (content.toLowerCase().includes(query)) {
              const lines = content.split("\n");
              const matches = [];
              lines.forEach((line, i) => {
                if (line.toLowerCase().includes(query)) {
                  matches.push({
                    line: i + 1,
                    text: line.trim().substring(0, 200),
                  });
                }
              });
              results.push({
                file: rel,
                matches: matches.slice(0, 5),
                totalMatches: matches.length,
              });
            }
          } catch {}
        }
      }
    }

    searchDir(join(curatorDir, "library"), "library");
    searchDir(join(curatorDir, "transcripts"), "transcripts");
    searchDir(join(curatorDir, "profiles"), "profiles");
    searchDir(join(curatorDir, "logs"), "logs");

    res.json({ results: results.slice(0, 30), query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activity feed
app.get("/api/activity", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_ACTIVITY);
  res.json({ activity: activityLog.slice(0, limit) });
});

// --- TODO CRUD + Planning/Scheduling Workflow ---
const VALID_TODO_STATUSES = new Set([
  "pending", "planning", "awaiting_approval", "approved",
  "scheduled", "executing", "completed", "failed",
]);
const VALID_PRIORITIES = ["low", "medium", "high"];

function readTodos() {
  try {
    if (!existsSync(TODOS_FILE)) return [];
    const raw = JSON.parse(readFileSync(TODOS_FILE, "utf-8"));
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.todos) ? raw.todos : [];
    return arr.map((t) => ({
      id: t.id || randomUUID(),
      task_number: t.task_number || null,
      title: t.title || t.text || "Untitled",
      description: t.description || null,
      status: t.status || "pending",
      priority: t.priority || "medium",
      context: t.context || null,
      created_at: t.created_at || (t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString()),
      completed_at: t.completed_at || null,
      plan_details: t.plan_details || null,
      run_log: t.run_log || null,
      failure_reason: t.failure_reason || null,
      completion_summary: t.completion_summary || null,
      execution_plan: t.execution_plan || null,
      execution_report: t.execution_report || null,
      approval_status: t.approval_status || null,
      scheduled_time: t.scheduled_time || null,
      run_post_op: t.run_post_op !== undefined ? t.run_post_op : true,
      plan_generated_at: t.plan_generated_at || null,
      plan_approved_at: t.plan_approved_at || null,
    }));
  } catch {
    return [];
  }
}

function writeTodos(todos) {
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// Run /oasis-ops after execution (fire-and-forget)
function runOasisOps(context) {
  const label = context || "post-todo-execution";
  console.log(`[oasis-ops] Triggering /oasis-ops after ${label}`);
  const child = spawn("claude", ["-p", "/oasis-ops"], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  child.on("close", (code) => console.log(`[oasis-ops] Completed after ${label} (exit ${code})`));
  child.on("error", (err) => console.error(`[oasis-ops] Failed after ${label}: ${err.message}`));
}

// Active streams for execution and planning progress
const todoProgressStreams = new Map();
const todoPlanStreams = new Map();

// Execute a task by spawning Claude (shared by /execute and scheduler)
function executeTask(todo) {
  const title = sanitizePromptInput(todo.title);
  const desc = sanitizePromptInput(todo.description || "", 1000);
  const ctx = sanitizePromptInput(todo.context || "", 200);
  const plan = sanitizePromptInput(todo.execution_plan || "", 2000);
  const planSection = plan ? `\n\nApproved Execution Plan:\n${plan}\n\nFollow this plan exactly.` : "";
  const prompt = `Execute this OASIS task:\n\nTitle: ${title}\n${desc ? `Description: ${desc}\n` : ""}${ctx ? `Context: ${ctx}\n` : ""}${planSection}\n\nComplete this task. Make all necessary file changes. Report what was done.`;

  let output = "";
  let errorOutput = "";
  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  todoProgressStreams.set(todo.id, { child, output: "" });
  child.stdout.on("data", (d) => {
    output += d.toString();
    const entry = todoProgressStreams.get(todo.id);
    if (entry) entry.output = output;
  });
  child.stderr.on("data", (d) => { errorOutput += d.toString(); });

  child.on("close", (code) => {
    const timestamp = new Date().toISOString();
    try {
      const all = readTodos();
      const t = all.find((x) => x.id === todo.id);
      if (t) {
        t.status = code === 0 ? "completed" : "failed";
        t.run_log = output.substring(0, 50000);
        const runHeader = `\n\n=== Execution ${timestamp} (exit ${code}) ===\n`;
        t.execution_report = ((t.execution_report || "") + runHeader + output).substring(0, 100000);
        t.failure_reason = code !== 0 ? (errorOutput || `Exit code ${code}`).substring(0, 2000) : null;
        t.completion_summary = code === 0 ? output.substring(0, 2000) : null;
        if (code === 0) t.completed_at = new Date().toISOString();
        writeTodos(all);
      }
    } catch (e) {
      console.error(`[todo-execute] Failed to update: ${e.message}`);
    }
    todoProgressStreams.delete(todo.id);
    if (todo.run_post_op !== false) runOasisOps(`todo-execute:${todo.title.substring(0, 40)}`);
  });

  child.on("error", (err) => {
    console.error(`[todo-execute] Spawn failed: ${err.message}`);
    try {
      const all = readTodos();
      const t = all.find((x) => x.id === todo.id);
      if (t) { t.status = "failed"; t.failure_reason = err.message; writeTodos(all); }
    } catch {}
    todoProgressStreams.delete(todo.id);
  });
}

// Scheduling poller: check every 60s for due scheduled tasks
setInterval(() => {
  try {
    const todos = readTodos();
    const now = Date.now();
    for (const todo of todos) {
      if (todo.scheduled_time && todo.approval_status === "approved" &&
          (todo.status === "scheduled" || todo.status === "approved") &&
          new Date(todo.scheduled_time).getTime() <= now) {
        console.log(`[scheduler] Executing scheduled task: ${todo.title}`);
        const all = readTodos();
        const t = all.find((x) => x.id === todo.id);
        if (t && (t.status === "scheduled" || t.status === "approved")) {
          t.status = "executing";
          t.scheduled_time = null;
          writeTodos(all);
        }
        logActivity("system", null, `Scheduled task executing: ${todo.title.substring(0, 60)}`);
        executeTask(todo);
        break;
      }
    }
  } catch (e) {
    console.error(`[scheduler] Poll error: ${e.message}`);
  }
}, 60_000);

app.get("/api/todos", (_req, res) => {
  res.json({ todos: readTodos() });
});

app.get("/api/todos/:id/details", (req, res) => {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: "Not found" });
  res.json({
    id: todo.id,
    description: todo.description,
    plan_details: todo.plan_details,
    run_log: todo.run_log,
    failure_reason: todo.failure_reason,
    completion_summary: todo.completion_summary,
    execution_plan: todo.execution_plan,
    execution_report: todo.execution_report,
    approval_status: todo.approval_status,
    scheduled_time: todo.scheduled_time,
    run_post_op: todo.run_post_op,
    plan_generated_at: todo.plan_generated_at,
    plan_approved_at: todo.plan_approved_at,
  });
});

app.post("/api/todos", (req, res) => {
  const { title, text, description, priority, context } = req.body;
  const todoTitle = (title || text || "").trim();
  if (!todoTitle) return res.status(400).json({ error: "title is required" });
  const todos = readTodos();
  const todo = {
    id: randomUUID(),
    title: todoTitle,
    description: description?.trim() || null,
    status: "pending",
    priority: VALID_PRIORITIES.includes(priority) ? priority : "medium",
    context: context?.trim() || null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  todos.unshift(todo);
  writeTodos(todos);
  logActivity("system", null, `TODO added: ${todoTitle.substring(0, 60)}`);
  res.json({ ok: true, todo });
});

app.patch("/api/todos/:id", (req, res) => {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: "Not found" });
  if (req.body.title !== undefined) todo.title = req.body.title;
  if (req.body.text !== undefined) todo.title = req.body.text;
  if (req.body.description !== undefined) todo.description = req.body.description || null;
  if (req.body.priority !== undefined && VALID_PRIORITIES.includes(req.body.priority)) todo.priority = req.body.priority;
  if (req.body.context !== undefined) todo.context = req.body.context || null;
  if (req.body.plan_details !== undefined) todo.plan_details = req.body.plan_details || null;
  if (req.body.run_log !== undefined) todo.run_log = req.body.run_log || null;
  if (req.body.failure_reason !== undefined) todo.failure_reason = req.body.failure_reason || null;
  if (req.body.completion_summary !== undefined) todo.completion_summary = req.body.completion_summary || null;
  if (req.body.execution_plan !== undefined) todo.execution_plan = req.body.execution_plan || null;
  if (req.body.execution_report !== undefined) todo.execution_report = req.body.execution_report || null;
  if (req.body.approval_status !== undefined) todo.approval_status = req.body.approval_status || null;
  if (req.body.scheduled_time !== undefined) todo.scheduled_time = req.body.scheduled_time || null;
  if (req.body.run_post_op !== undefined) todo.run_post_op = !!req.body.run_post_op;
  if (req.body.status !== undefined && VALID_TODO_STATUSES.has(req.body.status)) {
    const prevStatus = todo.status;
    todo.status = req.body.status;
    if (req.body.status === "completed" && !todo.completed_at) {todo.completed_at = new Date().toISOString();}
    if (req.body.status === "pending") {todo.completed_at = null;}
    if (todo.status === "pending" && prevStatus === "failed") {
      todo.failure_reason = null;
      todo.run_log = null;
      todo.plan_details = null;
    }
    if ((req.body.status === "completed" || req.body.status === "failed") &&
        prevStatus !== req.body.status && todo.run_post_op !== false) {
      runOasisOps(`todo:${todo.title.substring(0, 40)}`);
    }
  }
  writeTodos(todos);
  res.json({ ok: true, todo });
});

// POST /api/todos/:id/plan — generate execution plan with Claude
app.post("/api/todos/:id/plan", (req, res) => {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) {return res.status(404).json({ error: "Not found" });}
  if (todo.status === "executing" || todo.status === "completed") {
    return res.status(400).json({ error: `Cannot plan for todo with status '${todo.status}'` });
  }
  todo.status = "planning";
  todo.approval_status = "pending_plan";
  writeTodos(todos);
  logActivity("system", null, `Planning started: ${todo.title.substring(0, 60)}`);

  const sTitle = sanitizePromptInput(todo.title);
  const sDesc = sanitizePromptInput(todo.description || "", 1000);
  const sCtx = sanitizePromptInput(todo.context || "", 200);
  const prompt = `Create a detailed execution plan for this OASIS task:\n\nTitle: ${sTitle}\n${sDesc ? `Description: ${sDesc}` : ""}\n${sCtx ? `Context: ${sCtx}` : ""}\nPriority: ${todo.priority}\n\nProvide a concise, actionable plan:\n1. Step-by-step implementation approach\n2. Files to modify or create\n3. Risk assessment (low/medium/high)\n4. Any prerequisites or dependencies\n\nBe specific and practical. Use markdown formatting.`;

  let output = "";
  let errorOutput = "";
  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  todoPlanStreams.set(todo.id, { child, output: "" });
  child.stdout.on("data", (d) => {
    output += d.toString();
    const entry = todoPlanStreams.get(todo.id);
    if (entry) {entry.output = output;}
  });
  child.stderr.on("data", (d) => { errorOutput += d.toString(); });
  child.on("close", (code) => {
    try {
      const all = readTodos();
      const t = all.find((x) => x.id === todo.id);
      if (t) {
        t.execution_plan = output.substring(0, 50000);
        t.plan_generated_at = new Date().toISOString();
        if (code === 0 && output.trim()) {
          t.status = "awaiting_approval";
          t.approval_status = "pending_approval";
        } else {
          t.status = "pending";
          t.approval_status = null;
          t.failure_reason = (errorOutput || `Planning exited with code ${code}`).substring(0, 2000);
        }
        writeTodos(all);
      }
    } catch (e) {
      console.error(`[todo-plan] Failed to update: ${e.message}`);
    }
    todoPlanStreams.delete(todo.id);
    logActivity("system", null, `Plan ${code === 0 ? "generated" : "failed"}: ${todo.title.substring(0, 60)}`);
  });
  child.on("error", (err) => {
    try {
      const all = readTodos();
      const t = all.find((x) => x.id === todo.id);
      if (t) { t.status = "pending"; t.approval_status = null; t.failure_reason = err.message; writeTodos(all); }
    } catch {}
    todoPlanStreams.delete(todo.id);
  });
  res.json({ ok: true, status: "planning", todoId: todo.id });
});

// GET /api/todos/:id/plan-progress — poll planning output
app.get("/api/todos/:id/plan-progress", (req, res) => {
  const entry = todoPlanStreams.get(req.params.id);
  if (!entry) {return res.json({ status: "idle", output: "" });}
  res.json({ status: "planning", output: entry.output.substring(0, 50000) });
});

// POST /api/todos/:id/approve — approve, schedule, or reject a plan
app.post("/api/todos/:id/approve", (req, res) => {
  const { action, scheduled_time, run_post_op } = req.body;
  if (!action || !["approve", "approve_schedule", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approve', 'approve_schedule', or 'reject'" });
  }
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) {return res.status(404).json({ error: "Not found" });}
  if (!todo.execution_plan) {return res.status(400).json({ error: "No plan to approve" });}
  if (action === "reject") {
    todo.approval_status = "rejected";
    todo.status = "pending";
  } else {
    todo.approval_status = "approved";
    todo.plan_approved_at = new Date().toISOString();
    if (run_post_op !== undefined) {todo.run_post_op = !!run_post_op;}
    if (action === "approve_schedule" && scheduled_time) {
      todo.scheduled_time = scheduled_time;
      todo.status = "scheduled";
    } else {
      todo.status = "approved";
    }
  }
  writeTodos(todos);
  logActivity("system", null, `Plan ${action}: ${todo.title.substring(0, 60)}`);
  res.json({ ok: true, todo });
});

// POST /api/todos/:id/replan — discard plan and reset
app.post("/api/todos/:id/replan", (req, res) => {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) {return res.status(404).json({ error: "Not found" });}
  todo.execution_plan = null;
  todo.approval_status = null;
  todo.plan_generated_at = null;
  todo.plan_approved_at = null;
  todo.scheduled_time = null;
  todo.status = "pending";
  writeTodos(todos);
  logActivity("system", null, `Plan discarded: ${todo.title.substring(0, 60)}`);
  res.json({ ok: true, todo });
});

// POST /api/todos/:id/execute — execute todo with Claude Code (bypass permissions)
app.post("/api/todos/:id/execute", (req, res) => {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) {return res.status(404).json({ error: "Not found" });}
  if (todo.status === "executing" || todo.status === "completed") {
    return res.status(400).json({ error: `Cannot execute todo with status '${todo.status}'` });
  }
  todo.status = "executing";
  writeTodos(todos);
  logActivity("system", null, `TODO executing: ${todo.title.substring(0, 60)}`);
  executeTask(todo);
  res.json({ ok: true, status: "executing", todoId: todo.id });
});

// GET /api/todos/:id/progress — get execution progress
app.get("/api/todos/:id/progress", (req, res) => {
  const entry = todoProgressStreams.get(req.params.id);
  if (!entry) {return res.json({ status: "idle", output: "" });}
  res.json({ status: "executing", output: entry.output.substring(0, 50000) });
});

app.delete("/api/todos/:id", (req, res) => {
  const todos = readTodos();
  const idx = todos.findIndex((t) => t.id === req.params.id);
  if (idx < 0) {return res.status(404).json({ error: "Not found" });}
  const removed = todos.splice(idx, 1)[0];
  writeTodos(todos);
  logActivity("system", null, `TODO removed: ${(removed.title || "").substring(0, 60)}`);
  res.json({ ok: true });
});

// --- Ops Check ---
let currentOpsCheck = null;

app.post("/api/ops/trigger", (_req, res) => {
  if (currentOpsCheck && currentOpsCheck.status === "running") {
    return res.status(409).json({ error: "Ops check already running" });
  }
  const id = randomUUID();
  let output = "";
  let errorOutput = "";
  const child = spawn("claude", ["-p", "/oasis-ops"], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  currentOpsCheck = { id, status: "running", output: "", startedAt: new Date().toISOString(), exitCode: null, error: null };
  child.stdout.on("data", (d) => { output += d.toString(); if (currentOpsCheck) {currentOpsCheck.output = output;} });
  child.stderr.on("data", (d) => { errorOutput += d.toString(); });
  child.on("close", (code) => {
    if (currentOpsCheck && currentOpsCheck.id === id) {
      currentOpsCheck.status = code === 0 ? "complete" : "failed";
      currentOpsCheck.exitCode = code;
      currentOpsCheck.completedAt = new Date().toISOString();
      if (errorOutput) {currentOpsCheck.error = errorOutput.substring(0, 5000);}
    }
  });
  child.on("error", (err) => {
    if (currentOpsCheck && currentOpsCheck.id === id) { currentOpsCheck.status = "failed"; currentOpsCheck.error = err.message; }
  });
  logActivity("system", null, "Ops check triggered");
  res.json({ ok: true, id, status: "running" });
});

app.get("/api/ops/status", (_req, res) => {
  if (!currentOpsCheck) {return res.json({ status: "idle" });}
  res.json({
    id: currentOpsCheck.id,
    status: currentOpsCheck.status,
    output: (currentOpsCheck.output || "").substring(0, 50000),
    startedAt: currentOpsCheck.startedAt,
    completedAt: currentOpsCheck.completedAt || null,
    exitCode: currentOpsCheck.exitCode,
    error: currentOpsCheck.error,
  });
});

// --- Audit Routes (QA & Security) ---
const AUDIT_REPORTS_DIR = join(CONFIG_DIR, "audit-reports");
const runningAudits = new Map();

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function saveAuditReport(type, report) {
  const dir = join(AUDIT_REPORTS_DIR, type);
  ensureDir(dir);
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const path = join(dir, `${id}.json`);
  try { writeFileSync(path, JSON.stringify({ id, ...report }, null, 2)); } catch (e) { console.error(`[audit] Save failed: ${e.message}`); }
  return id;
}

function listAuditReports(type) {
  const dir = join(AUDIT_REPORTS_DIR, type);
  if (!existsSync(dir)) {return [];}
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
          return { id: data.id, startedAt: data.startedAt, completedAt: data.completedAt, status: data.status, type: data.type, summary: data.summary || null };
        } catch { return null; }
      })
      .filter(Boolean)
      .toSorted((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  } catch { return []; }
}

function spawnAudit(type, prompt) {
  const auditId = randomUUID();
  const startedAt = new Date().toISOString();
  let output = "";
  let errorOutput = "";
  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  runningAudits.set(auditId, { id: auditId, type, pid: child.pid, startedAt, status: "running", output: "" });
  child.stdout.on("data", (d) => { output += d.toString(); const e = runningAudits.get(auditId); if (e) {e.output = output;} });
  child.stderr.on("data", (d) => { errorOutput += d.toString(); });
  child.on("close", (code) => {
    const entry = runningAudits.get(auditId);
    const status = code === 0 ? "completed" : "failed";
    saveAuditReport(type, { id: auditId, type, startedAt, completedAt: new Date().toISOString(), status, exitCode: code, output, error: errorOutput || null, summary: output.substring(0, 500) });
    if (entry) { entry.status = status; }
  });
  child.on("error", (err) => { const e = runningAudits.get(auditId); if (e) { e.status = "failed"; e.error = err.message; } });
  return auditId;
}

// QA Audit
app.post("/api/audit/qa/trigger", (_req, res) => {
  const prompt = `Perform a QA audit of the OASIS dashboard system. Check:\n1. All API endpoints are responding correctly\n2. Configuration files are valid JSON\n3. Docker containers are running and healthy\n4. Gateway WebSocket connection is stable\n5. Voice pipeline has no stuck jobs\n6. Cron jobs are running on schedule\nReport any issues found with severity levels (HIGH/MEDIUM/LOW).`;
  const auditId = spawnAudit("qa", prompt);
  res.json({ ok: true, auditId, status: "running" });
});

app.get("/api/audit/qa/status", (_req, res) => {
  const audits = [];
  for (const [, a] of runningAudits) { if (a.type === "qa") {audits.push({ id: a.id, status: a.status, startedAt: a.startedAt, outputLength: a.output.length });} }
  res.json({ audits });
});

app.get("/api/audit/qa/reports", (_req, res) => { res.json({ reports: listAuditReports("qa") }); });

// Security Audit
app.post("/api/audit/security/trigger", (_req, res) => {
  const prompt = `Perform a security audit of the OASIS dashboard system. Check:\n1. Authentication is properly enforced on all endpoints\n2. No sensitive credentials are exposed in responses\n3. Input validation is present on all user-supplied parameters\n4. File path traversal vulnerabilities\n5. Rate limiting is functioning\n6. Security headers are set correctly\nReport any vulnerabilities with severity ratings.`;
  const auditId = spawnAudit("security", prompt);
  res.json({ ok: true, auditId, status: "running" });
});

app.get("/api/audit/security/status", (_req, res) => {
  const audits = [];
  for (const [, a] of runningAudits) { if (a.type === "security") {audits.push({ id: a.id, status: a.status, startedAt: a.startedAt, outputLength: a.output.length });} }
  res.json({ audits });
});

app.get("/api/audit/security/reports", (_req, res) => { res.json({ reports: listAuditReports("security") }); });

// Generate tasks from audit findings
app.post("/api/audit/:type/generate-tasks", (req, res) => {
  const { type } = req.params;
  if (!["qa", "security"].includes(type)) {return res.status(400).json({ error: "Invalid audit type" });}
  const { findings } = req.body;
  if (!Array.isArray(findings) || findings.length === 0) {return res.status(400).json({ error: "findings array required" });}

  const severityToPriority = { critical: "high", high: "high", medium: "medium", warning: "medium", low: "low", info: "low" };
  const todos = readTodos();
  const created = [];
  for (const finding of findings) {
    const title = sanitizePromptInput(typeof finding === "string" ? finding : finding.title || finding.name || "Audit finding", 500);
    const severity = (typeof finding === "object" ? (finding.severity || finding.risk || "medium") : "medium").toLowerCase();
    const description = typeof finding === "object" ? sanitizePromptInput(finding.description || finding.suggestedFix || "", 1000) || null : null;
    const todo = {
      id: randomUUID(),
      title,
      description,
      status: "pending",
      priority: severityToPriority[severity] || "medium",
      context: `${type}-audit`,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    todos.unshift(todo);
    created.push(todo);
  }
  writeTodos(todos);
  logActivity("system", null, `${created.length} tasks generated from ${type} audit`);
  res.json({ ok: true, count: created.length, tasks: created });
});

// Gateway container logs
app.get("/api/logs/gateway", async (req, res) => {
  const tail = Math.min(parseInt(req.query.tail) || 200, 1000);
  const since = sanitizeDockerParam(req.query.since || "");

  try {
    let path = `/containers/${GATEWAY_CONTAINER}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`;
    if (since) {path += `&since=${since}`;}

    const result = await dockerRequest(path);
    if (result.statusCode !== 200) {
      return res.status(502).json({
        error: `Docker API returned ${result.statusCode}`,
        body: result.body.toString("utf-8").substring(0, 500),
      });
    }

    const lines = parseDockerLogs(result.body);
    res.json({ lines, count: lines.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Curator file content
app.get("/api/curator/file", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {return res.status(400).json({ error: "path required" });}

  const curatorDir = resolve(join(CONFIG_DIR, "workspace-curator"));
  let fullPath = resolve(join(curatorDir, filePath));

  if (!fullPath.startsWith(curatorDir + "/")) {
    return res.status(403).json({ error: "Access denied" });
  }

  // If not found at direct path, try under library/ (tree returns paths relative to library/)
  if (!existsSync(fullPath)) {
    const libraryPath = resolve(join(curatorDir, "library", filePath));
    if (libraryPath.startsWith(curatorDir + "/") && existsSync(libraryPath)) {
      fullPath = libraryPath;
    }
  }

  try {
    if (!existsSync(fullPath)) {return res.status(404).json({ error: "File not found" });}
    const content = readFileSync(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Curator AI chat (SSE streaming via Gemini 2.5 Flash)
app.post("/api/curator/chat", async (req, res) => {
  const { message, context, history } = req.body;
  if (!message) {return res.status(400).json({ error: "message required" });}
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const systemText = [
      "You are a knowledge base assistant for the OASIS system.",
      "Answer questions based ONLY on the document content provided below.",
      "Do not fabricate information — if the answer is not in the document, say so.",
      "Be concise and helpful. Use markdown formatting.",
      "",
      "--- DOCUMENT ---",
      context || "(no document loaded)",
      "--- END DOCUMENT ---",
    ].join("\n");

    const contents = [];
    if (history?.length) {
      for (const h of history) {
        contents.push({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.text }],
        });
      }
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { temperature: 0.3 },
        }),
      },
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.write(
        `data: ${JSON.stringify({ type: "error", text: `Gemini API error ${apiRes.status}: ${errText.substring(0, 200)}` })}\n\n`,
      );
      res.end();
      return;
    }

    let buffer = "";
    for await (const chunk of apiRes.body) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) {continue;}
        const data = line.slice(6).trim();
        if (!data) {continue;}
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: "token", text })}\n\n`);
          }
        } catch {}
      }
    }

    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6).trim();
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: "token", text })}\n\n`);
          }
        } catch {}
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    try {
      res.write(`data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`);
      res.end();
    } catch {}
  }
});

// --- Recipe API ---
const MEAL_PLANS_DIR = join(CONFIG_DIR, "workspace-anorak", "meal-plans");
const VALID_WEEK = /^\d{4}-W\d{2}$/;
const VALID_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

app.get("/api/recipes/weeks", (_req, res) => {
  try {
    if (!existsSync(MEAL_PLANS_DIR)) {return res.json({ weeks: [] });}
    const entries = readdirSync(MEAL_PLANS_DIR, { withFileTypes: true });
    const weeks = entries
      .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
      .map((e) => e.name.replace("-recipes", ""))
      .toSorted()
      .toReversed();
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/recipes/:week", (req, res) => {
  const { week } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  try {
    const dir = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`));
    if (!dir.startsWith(resolve(MEAL_PLANS_DIR)))
      {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(dir)) {return res.json({ week, days: [] });}
    const days = VALID_DAYS.map((day) => {
      const file = join(dir, `${day}.md`);
      if (!existsSync(file)) {return { day, exists: false };}
      const content = readFileSync(file, "utf-8");
      const titleMatch = content.match(/^#\s+(.+)/m);
      const timeMatch =
        content.match(/\*\*(?:Total|Cook)\s*(?:Time|time)[:\s]*\*\*\s*(.+)/i) ||
        content.match(/(?:Total|Cook)\s*(?:Time|time)[:\s]+(\d+\s*min(?:utes)?)/i);
      return {
        day,
        exists: true,
        title: titleMatch ? titleMatch[1].trim() : day,
        cookTime: timeMatch ? timeMatch[1].trim() : null,
      };
    });
    res.json({ week, days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/recipes/:week/:day", (req, res) => {
  const { week, day } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  if (!VALID_DAYS.includes(day)) {return res.status(400).json({ error: "Invalid day" });}
  try {
    const file = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`, `${day}.md`));
    if (!file.startsWith(resolve(MEAL_PLANS_DIR)))
      {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(file)) {return res.status(404).json({ error: "Recipe not found" });}
    const content = readFileSync(file, "utf-8");
    res.json({ week, day, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Voice Pipeline API ---
const AUDIO_LISTENER_URL =
  process.env.AUDIO_LISTENER_URL || "http://audio-listener:9001";

// Voice stats, transcripts, profiles, candidates, audio, pipeline handled by modular voiceRoutes

// Trigger speaker re-identification (not in modular voice.js, keep inline)
app.post("/api/voice/reidentify", async (_req, res) => {
  try {
    const r = await fetch(`${AUDIO_LISTENER_URL}/reidentify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force_all: true }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    logActivity("system", null, "Speaker re-identification triggered");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modular routes — mounted after inline routes so inline endpoints keep priority,
// while modular routes fill in missing endpoints (tree, insights, pipeline, profiles, candidates, etc.)
app.use("/api/curator", curatorRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/cron", cronModularRoutes);
app.use("/api/audit", auditModularRoutes);
app.use("/api/ops", opsRoutes);

// Knowledge routes — proxy to curator endpoints for backward compatibility
app.get("/api/knowledge/search", (req, res) => {
  const query = (req.query.q || "").toLowerCase().trim();
  if (!query) {return res.json({ results: [] });}
  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator");
    const results = [];
    function searchDir(dir, relPath = "") {
      if (!existsSync(dir)) {return;}
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) {continue;}
        const fullPath = join(dir, entry.name);
        const rel = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          searchDir(fullPath, rel);
        } else if (/\.(md|txt|json)$/i.test(entry.name)) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            if (content.toLowerCase().includes(query)) {
              const lines = content.split("\n");
              const matches = [];
              lines.forEach((line, i) => {
                if (line.toLowerCase().includes(query)) {
                  matches.push({ line: i + 1, text: line.trim().substring(0, 200) });
                }
              });
              results.push({ file: rel, matches: matches.slice(0, 5), totalMatches: matches.length });
            }
          } catch {}
        }
      }
    }
    searchDir(join(curatorDir, "library"), "library");
    searchDir(join(curatorDir, "transcripts"), "transcripts");
    searchDir(join(curatorDir, "profiles"), "profiles");
    res.json({ results: results.slice(0, 30), query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/knowledge/categories", (_req, res) => {
  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator", "library");
    if (!existsSync(curatorDir)) {return res.json({ categories: [] });}
    const categories = readdirSync(curatorDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => {
        let count = 0;
        try { count = readdirSync(join(curatorDir, d.name)).filter((f) => !f.startsWith(".")).length; } catch {}
        return { name: d.name, count };
      });
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aech opportunities — alias for deals endpoint
app.get("/api/aech/opportunities", (_req, res) => {
  try {
    const dealsPath = join(CONFIG_DIR, "workspace-aech", "deals.json");
    if (!existsSync(dealsPath)) {return res.json({ opportunities: [] });}
    const deals = JSON.parse(readFileSync(dealsPath, "utf-8"));
    const opportunities = (Array.isArray(deals) ? deals : [])
      .filter((d) => d.status === "identified" || d.status === "approved");
    res.json({ opportunities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start
const server = http.createServer(app);

// WebSocket server for real-time dashboard updates
const dashboardWs = new DashboardWebSocket(server, { authUser: AUTH_USER, authPass: AUTH_PASS });
global.dashboardWs = dashboardWs;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OASIS Dashboard listening on port ${PORT}`);
  logActivity("system", null, "Dashboard started");
  // Start activity poller after a short delay to let gateway finish starting
  setTimeout(startActivityPoller, 5_000);
});
