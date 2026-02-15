import express from "express";
import { WebSocket } from "ws";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomUUID, timingSafeEqual } from "crypto";
import http from "http";

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
  if (activityLog.length > MAX_ACTIVITY) activityLog.length = MAX_ACTIVITY;
}

// --- Activity Poller (real gateway events) ---
let prevSessionState = {};
let prevCronState = {};
let pollerStarted = false;

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
      const sessions = Array.isArray(sessResult.sessions)
        ? sessResult.sessions
        : [];
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
              s.lastMessage?.text?.substring(0, 80) ||
              s.lastMessage?.content?.substring(0, 80);
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
          logActivity(
            "cron_run",
            j.agentId,
            `${j.name} ${statusEmoji}${dur}`
          );
        }
        prevCronState[j.id] = { lastRunAtMs, lastStatus };
      }
    }
  } catch (e) {
    // Silent — don't crash the poller
  }
}

function startActivityPoller() {
  if (pollerStarted) return;
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
        `Activity poller seeded: ${Object.keys(prevSessionState).length} sessions, ${Object.keys(prevCronState).length} cron jobs`
      );
    } catch {}
  })();
  setInterval(pollGatewayActivity, 15_000);
}

// --- Basic Auth Middleware ---
function basicAuth(req, res, next) {
  if (!AUTH_USER || !AUTH_PASS) return next();
  // Exempt health endpoint for Docker healthchecks
  if (req.path === "/api/health") return next();
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
  // Constant-time comparison
  const userBuf = Buffer.from(user);
  const passBuf = Buffer.from(pass);
  const expectUserBuf = Buffer.from(AUTH_USER);
  const expectPassBuf = Buffer.from(AUTH_PASS);
  const userOk =
    userBuf.length === expectUserBuf.length &&
    timingSafeEqual(userBuf, expectUserBuf);
  const passOk =
    passBuf.length === expectPassBuf.length &&
    timingSafeEqual(passBuf, expectPassBuf);
  if (userOk && passOk) return next();
  res.set("WWW-Authenticate", 'Basic realm="OASIS Dashboard"');
  return res.status(401).send("Invalid credentials");
}

app.use(basicAuth);
app.use(express.static("public"));
app.use(express.json());

// --- Gateway WS RPC ---
function rpcCall(method, params = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_WS);
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
                  id: "gateway-client",
                  version: "1.0.0",
                  platform: "node",
                  mode: "backend",
                },
                role: "operator",
                scopes: ["operator.admin"],
                auth: { token: TOKEN },
              },
            })
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
          ws.send(
            JSON.stringify({ type: "req", id: randomUUID(), method, params })
          );
          return;
        }

        if (msg.type === "res" && authenticated) {
          clearTimeout(timeout);
          if (msg.error)
            reject(
              new Error(msg.error.message || JSON.stringify(msg.error))
            );
          else resolve(msg.result ?? msg.payload ?? null);
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
    if (!existsSync(path)) return null;
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
      (buf[offset + 4] << 24) |
      (buf[offset + 5] << 16) |
      (buf[offset + 6] << 8) |
      buf[offset + 7];
    offset += 8;
    if (offset + size > buf.length) break;
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
  if (
    cache.ethPrice.data &&
    Date.now() - cache.ethPrice.ts < cache.ethPrice.ttl
  )
    return cache.ethPrice.data;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
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
  const paddedAddr = address
    .toLowerCase()
    .replace("0x", "")
    .padStart(64, "0");
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        { to: USDC_CONTRACT, data: selector + paddedAddr },
        "latest",
      ],
      id: 1,
    }),
  });
  const data = await res.json();
  return parseInt(data.result, 16) / 1e6;
}

async function getTreasuryData() {
  if (
    cache.treasury.data &&
    Date.now() - cache.treasury.ts < cache.treasury.ttl
  )
    return cache.treasury.data;

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
        .toFixed(2)
    ),
  };
  cache.treasury.data = data;
  cache.treasury.ts = Date.now();
  return data;
}

async function getTransactions(address) {
  const key = address.toLowerCase();
  const cached = cache.txHistory.get(key);
  if (cached && Date.now() - cached.ts < TX_CACHE_TTL) return cached.data;

  const [txRes, tokenRes] = await Promise.all([
    fetch(`${BLOCKSCOUT_API}/addresses/${address}/transactions`),
    fetch(`${BLOCKSCOUT_API}/addresses/${address}/token-transfers`),
  ]);
  const [txData, tokenData] = await Promise.all([
    txRes.json(),
    tokenRes.json(),
  ]);

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
      value: parseFloat(
        (parseInt(total.value || "0") / Math.pow(10, decimals)).toFixed(8)
      ),
      symbol: tx.token?.symbol || "TOKEN",
      timestamp: new Date(tx.timestamp).getTime(),
      direction: from.toLowerCase() === key ? "out" : "in",
    };
  });

  const merged = [...normal, ...tokens]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30);
  cache.txHistory.set(key, { data: merged, ts: Date.now() });
  return merged;
}

// =========== API Routes ===========

// Health
app.get("/api/health", async (_req, res) => {
  try {
    const result = await rpcCall("health");
    res.json({ status: "ok", gateway: result });
  } catch (err) {
    res.json({ status: "degraded", error: err.message });
  }
});

// System health
app.get("/api/system", async (_req, res) => {
  try {
    const health = await rpcCall("health");
    const mem = process.memoryUsage();
    res.json({
      dashboard: {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heap: Math.round(mem.heapUsed / 1024 / 1024),
        },
      },
      gateway: health,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agents
app.get("/api/agents", async (_req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) return res.json({ agents: [], error: "Config not found" });
    const agents = (config.agents?.list || []).map((a) => ({
      id: a.id,
      name: a.name || a.identity?.name || a.id,
      emoji: a.identity?.emoji || "",
      theme: a.identity?.theme || "",
      tools: a.tools?.allow || [],
      workspace: a.workspace,
    }));
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      lastRunAt: j.state?.lastRunAtMs
        ? new Date(j.state.lastRunAtMs).toISOString()
        : null,
      nextRunAt: j.state?.nextRunAtMs
        ? new Date(j.state.nextRunAtMs).toISOString()
        : null,
      lastDurationMs: j.state?.lastDurationMs || null,
      consecutiveErrors: j.state?.consecutiveErrors || 0,
      lastError: j.state?.lastError || null,
    }));
    res.json({ jobs: summary });
  } catch (err) {
    try {
      const jobs = readJsonFile(join(CONFIG_DIR, "cron", "jobs.json"));
      if (!jobs) return res.json({ jobs: [] });
      const summary = (jobs.jobs || []).map((j) => ({
        id: j.id,
        name: j.name,
        agentId: j.agentId,
        enabled: j.enabled,
        schedule: j.schedule?.expr,
        tz: j.schedule?.tz,
        lastStatus: j.state?.lastStatus || "never",
        lastRunAt: j.state?.lastRunAtMs
          ? new Date(j.state.lastRunAtMs).toISOString()
          : null,
        nextRunAt: j.state?.nextRunAtMs
          ? new Date(j.state.nextRunAtMs).toISOString()
          : null,
        lastDurationMs: j.state?.lastDurationMs || null,
        consecutiveErrors: j.state?.consecutiveErrors || 0,
        lastError: j.state?.lastError || null,
      }));
      res.json({ jobs: summary });
    } catch {
      res.status(500).json({ error: err.message });
    }
  }
});

// Cron toggle
app.post("/api/cron/:jobId/toggle", async (req, res) => {
  try {
    const list = await rpcCall("cron.list", { includeDisabled: true });
    const job = (list.jobs || []).find((j) => j.id === req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const newEnabled = !job.enabled;
    await rpcCall("cron.update", {
      jobId: req.params.jobId,
      patch: { enabled: newEnabled },
    });
    logActivity(
      "cron_toggle",
      job.agentId,
      `${job.name} ${newEnabled ? "enabled" : "disabled"}`
    );
    res.json({ ok: true, enabled: newEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cron trigger
app.post("/api/cron/:jobId/run", async (req, res) => {
  try {
    const result = await rpcCall(
      "cron.run",
      { jobId: req.params.jobId, mode: "force" },
      30_000
    );
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
    res.status(500).json({ error: err.message });
  }
});

// Sessions
app.get("/api/sessions", async (req, res) => {
  try {
    const params = {
      limit: 100,
      activeMinutes: 1440,
      includeLastMessage: true,
      includeDerivedTitles: true,
    };
    if (req.query.agentId) params.agentId = req.query.agentId;
    const result = await rpcCall("sessions.list", params);
    res.json(result || { sessions: [] });
  } catch (err) {
    res.json({ sessions: [], error: err.message });
  }
});

// Send message to agent
app.post("/api/agents/:agentId/message", async (req, res) => {
  const { message } = req.body;
  if (!message)
    return res.status(400).json({ ok: false, error: "message is required" });
  try {
    const idempotencyKey = randomUUID();
    const result = await rpcCall(
      "agent",
      {
        agentId: req.params.agentId,
        message,
        idempotencyKey,
        deliver: false,
      },
      120_000
    );
    logActivity(
      "agent_message",
      req.params.agentId,
      message.substring(0, 100)
    );
    res.json({ ok: true, runId: result?.runId || idempotencyKey, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Treasury balances
app.get("/api/treasury", async (_req, res) => {
  try {
    const data = await getTreasuryData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transaction history
app.get("/api/treasury/:address/transactions", async (req, res) => {
  try {
    const txs = await getTransactions(req.params.address);
    res.json({ transactions: txs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Curator search
app.get("/api/curator/search", async (req, res) => {
  const query = (req.query.q || "").toLowerCase().trim();
  if (!query) return res.json({ results: [] });

  try {
    const curatorDir = join(CONFIG_DIR, "workspace-curator");
    const results = [];

    function searchDir(dir, relPath = "") {
      if (!existsSync(dir)) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
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

// --- TODO CRUD ---
// New format: flat JSON array of objects with title, description, priority, context, etc.
// Legacy format: { todos: [{ id, text, createdAt, status }] }
const VALID_TODO_STATUSES = ["pending", "planning", "awaiting_approval", "executing", "completed", "failed"];
const VALID_PRIORITIES = ["low", "medium", "high"];

function readTodos() {
  try {
    if (!existsSync(TODOS_FILE)) return [];
    const raw = JSON.parse(readFileSync(TODOS_FILE, "utf-8"));
    // Handle legacy wrapped format: { todos: [...] }
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.todos) ? raw.todos : [];
    // Normalize legacy items (text → title, createdAt → created_at)
    return arr.map((t) => ({
      id: t.id || randomUUID(),
      title: t.title || t.text || "Untitled",
      description: t.description || null,
      status: t.status || "pending",
      priority: t.priority || "medium",
      context: t.context || null,
      created_at: t.created_at || (t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString()),
      completed_at: t.completed_at || null,
    }));
  } catch {
    return [];
  }
}

function writeTodos(todos) {
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}

app.get("/api/todos", (_req, res) => {
  res.json({ todos: readTodos() });
});

app.post("/api/todos", (req, res) => {
  const { title, text, description, priority, context } = req.body;
  const todoTitle = (title || text || "").trim();
  if (!todoTitle)
    return res.status(400).json({ error: "title is required" });
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
  if (req.body.text !== undefined) todo.title = req.body.text; // legacy compat
  if (req.body.description !== undefined) todo.description = req.body.description || null;
  if (req.body.priority !== undefined && VALID_PRIORITIES.includes(req.body.priority)) todo.priority = req.body.priority;
  if (req.body.context !== undefined) todo.context = req.body.context || null;
  if (req.body.status !== undefined && VALID_TODO_STATUSES.includes(req.body.status)) {
    todo.status = req.body.status;
    if (req.body.status === "completed" && !todo.completed_at) {
      todo.completed_at = new Date().toISOString();
    }
    if (req.body.status === "pending") {
      todo.completed_at = null;
    }
  }
  writeTodos(todos);
  res.json({ ok: true, todo });
});

app.post("/api/todos/:id/run", (req, res) => {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: "Not found" });
  if (todo.status !== "pending")
    return res
      .status(400)
      .json({ error: `Cannot run todo with status '${todo.status}'` });
  todo.status = "planning";
  writeTodos(todos);
  // Write trigger file for the host-side approval-listener to pick up
  const triggerFile = join(CONFIG_DIR, "todo-run-queue.json");
  let queue = [];
  try {
    if (existsSync(triggerFile))
      queue = JSON.parse(readFileSync(triggerFile, "utf-8"));
  } catch {}
  if (!queue.includes(todo.id)) queue.push(todo.id);
  writeFileSync(triggerFile, JSON.stringify(queue));
  logActivity("system", null, `TODO queued for immediate run: ${todo.title.substring(0, 60)}`);
  res.json({ ok: true, todo });
});

app.delete("/api/todos/:id", (req, res) => {
  const todos = readTodos();
  const idx = todos.findIndex((t) => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Not found" });
  const removed = todos.splice(idx, 1)[0];
  writeTodos(todos);
  logActivity(
    "system",
    null,
    `TODO removed: ${(removed.title || "").substring(0, 60)}`
  );
  res.json({ ok: true });
});

// Gateway container logs
app.get("/api/logs/gateway", async (req, res) => {
  const tail = Math.min(parseInt(req.query.tail) || 200, 1000);
  const since = req.query.since || "";

  try {
    let path = `/containers/${GATEWAY_CONTAINER}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`;
    if (since) path += `&since=${since}`;

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
  if (!filePath) return res.status(400).json({ error: "path required" });

  const curatorDir = resolve(join(CONFIG_DIR, "workspace-curator"));
  const fullPath = resolve(join(curatorDir, filePath));

  if (!fullPath.startsWith(curatorDir + "/")) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    if (!existsSync(fullPath))
      return res.status(404).json({ error: "File not found" });
    const content = readFileSync(fullPath, "utf-8");
    res.json({ path: filePath, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Curator AI chat (SSE streaming via Gemini 2.5 Flash)
app.post("/api/curator/chat", async (req, res) => {
  const { message, context, history } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { temperature: 0.3 },
        }),
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.write(
        `data: ${JSON.stringify({ type: "error", text: `Gemini API error ${apiRes.status}: ${errText.substring(0, 200)}` })}\n\n`
      );
      res.end();
      return;
    }

    let buffer = "";
    for await (const chunk of apiRes.body) {
      buffer +=
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
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
      res.write(
        `data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`
      );
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
    if (!existsSync(MEAL_PLANS_DIR)) return res.json({ weeks: [] });
    const entries = readdirSync(MEAL_PLANS_DIR, { withFileTypes: true });
    const weeks = entries
      .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
      .map((e) => e.name.replace("-recipes", ""))
      .sort()
      .reverse();
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/recipes/:week", (req, res) => {
  const { week } = req.params;
  if (!VALID_WEEK.test(week)) return res.status(400).json({ error: "Invalid week format" });
  try {
    const dir = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`));
    if (!dir.startsWith(resolve(MEAL_PLANS_DIR))) return res.status(403).json({ error: "Access denied" });
    if (!existsSync(dir)) return res.json({ week, days: [] });
    const days = VALID_DAYS.map((day) => {
      const file = join(dir, `${day}.md`);
      if (!existsSync(file)) return { day, exists: false };
      const content = readFileSync(file, "utf-8");
      const titleMatch = content.match(/^#\s+(.+)/m);
      const timeMatch = content.match(/\*\*(?:Total|Cook)\s*(?:Time|time)[:\s]*\*\*\s*(.+)/i)
        || content.match(/(?:Total|Cook)\s*(?:Time|time)[:\s]+(\d+\s*min(?:utes)?)/i);
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
  if (!VALID_WEEK.test(week)) return res.status(400).json({ error: "Invalid week format" });
  if (!VALID_DAYS.includes(day)) return res.status(400).json({ error: "Invalid day" });
  try {
    const file = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`, `${day}.md`));
    if (!file.startsWith(resolve(MEAL_PLANS_DIR))) return res.status(403).json({ error: "Access denied" });
    if (!existsSync(file)) return res.status(404).json({ error: "Recipe not found" });
    const content = readFileSync(file, "utf-8");
    res.json({ week, day, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start
const server = http.createServer(app);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OASIS Dashboard listening on port ${PORT}`);
  logActivity("system", null, "Dashboard started");
  // Start activity poller after a short delay to let gateway finish starting
  setTimeout(startActivityPoller, 5_000);
});
