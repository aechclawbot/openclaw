/**
 * OASIS Dashboard v3 - Settings Routes
 * Config read/update, models, bindings, channels, usage.
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { rpcCall } from "../services/gateway-client.js";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";

function readJsonFile(path) {
  try {
    if (!existsSync(path)) {return null;}
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

const SENSITIVE_KEYS = ["token", "apiKey", "botToken", "secret", "password", "webhookSecret", "signingSecret"];

/**
 * Attempt to hot-reload the gateway config via config.get + config.patch RPC.
 * Falls back silently -- the file is already written, so the change takes
 * effect on next gateway restart at worst.
 */
async function tryHotReloadGateway(updatedConfig) {
  try {
    const snapshot = await rpcCall("config.get", {}, 10_000);
    const baseHash = snapshot?.hash ?? snapshot?.baseHash;
    if (!baseHash) {return false;}
    await rpcCall("config.patch", {
      baseHash,
      raw: JSON.stringify(updatedConfig),
    }, 10_000);
    return true;
  } catch {
    return false;
  }
}

// GET /settings — read config as structured settings for the UI
router.get("/settings", (req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) {return res.json({ error: "Config not found" });}

    // Extract structured settings the UI needs
    const defaults = config.agents?.defaults || {};
    const model = defaults.model || {};
    const defaultAgentEntry = (config.agents?.list || []).find((a) => a.default === true);

    // Gateway info
    const gw = config.gateway || {};

    // Hooks
    const hooks = config.hooks || {};

    // Skills
    const skills = config.skills || {};

    // Plugins summary
    const plugins = {};
    for (const [id, entry] of Object.entries(config.plugins?.entries || {})) {
      plugins[id] = { enabled: entry.enabled !== false };
    }

    res.json({
      // Model settings
      defaultModel: model.primary || "",
      fallbacks: model.fallbacks || [],

      // Agent settings
      defaultAgent: config.agents?.defaultAgentId || defaultAgentEntry?.id || "",
      agents: (config.agents?.list || []).map((a) => ({
        id: a.id,
        name: a.name || a.id,
        emoji: a.identity?.emoji || "",
        model: a.model?.primary || a.model || null,
        isDefault: a.default === true || a.id === (config.agents?.defaultAgentId || defaultAgentEntry?.id),
      })),

      // Gateway
      gateway: {
        port: gw.port || 18789,
        mode: gw.mode || "local",
        bind: gw.bind || "loopback",
      },

      // Hooks
      hooks: {
        enabled: hooks.enabled === true,
        internal: hooks.internal?.enabled === true,
        entries: Object.keys(hooks.internal?.entries || {}),
      },

      // Skills
      skills: {
        entries: Object.keys(skills.entries || {}),
        nodeManager: skills.install?.nodeManager || "npm",
      },

      // Plugins
      plugins,

      // Full config for reference
      config,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /settings — update top-level settings
router.post("/settings", async (req, res) => {
  try {
    const configPath = join(CONFIG_DIR, "openclaw.json");
    const config = readJsonFile(configPath);
    if (!config) {return res.status(500).json({ error: "Config not found" });}

    const { defaultAgent, defaultModel, fallbacks, defaultFallbacks } = req.body;
    const changes = [];

    if (defaultAgent !== undefined) {
      // Set the default agent by updating the list entry's default flag
      config.agents = config.agents || {};
      config.agents.list = config.agents.list || [];
      // Clear existing defaults
      for (const a of config.agents.list) {
        delete a.default;
      }
      // Set new default
      const targetAgent = config.agents.list.find((a) => a.id === defaultAgent);
      if (targetAgent) {
        targetAgent.default = true;
        changes.push(`defaultAgent=${defaultAgent}`);
      }
    }
    if (defaultModel) {
      config.agents = config.agents || {};
      config.agents.defaults = config.agents.defaults || {};
      config.agents.defaults.model = config.agents.defaults.model || {};
      config.agents.defaults.model.primary = defaultModel;
      changes.push(`defaultModel=${defaultModel}`);
    }
    const fb = Array.isArray(fallbacks) ? fallbacks : (Array.isArray(defaultFallbacks) ? defaultFallbacks : null);
    if (fb) {
      config.agents = config.agents || {};
      config.agents.defaults = config.agents.defaults || {};
      config.agents.defaults.model = config.agents.defaults.model || {};
      config.agents.defaults.model.fallbacks = fb;
      changes.push(`fallbacks=[${fb.length}]`);
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));

    let reloadStatus = 'restart-required';
    try {
      const reloaded = await tryHotReloadGateway(config);
      reloadStatus = reloaded ? 'applied' : 'restart-required';
    } catch {
      reloadStatus = 'restart-required';
    }

    logActivity("system", null, `Settings updated: ${changes.join(", ") || Object.keys(req.body).join(", ")}`);
    res.json({ ok: true, changes, reloadStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /models — list available models from config
router.get("/models", (_req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) {return res.json({ models: [] });}
    const models = [];
    for (const [providerId, provider] of Object.entries(config.models?.providers || {})) {
      for (const m of provider.models || []) {
        models.push({ id: `${providerId}/${m.id}`, name: m.name, provider: providerId });
      }
    }
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /bindings — get routing bindings
router.get("/bindings", (req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) {return res.json({ bindings: [] });}
    // Bindings can be at top-level config.bindings or config.routing.bindings
    const bindings = config.bindings || config.routing?.bindings || [];
    res.json({ bindings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /bindings — update routing bindings (replace all)
router.put("/bindings", async (req, res) => {
  try {
    const { bindings } = req.body;
    if (!Array.isArray(bindings)) {
      return res.status(400).json({ error: "bindings must be an array" });
    }
    for (const b of bindings) {
      if (!b.agentId || !b.match) {
        return res.status(400).json({ error: "Each binding must have agentId and match" });
      }
    }
    const configPath = join(CONFIG_DIR, "openclaw.json");
    const config = readJsonFile(configPath);
    if (!config) {return res.status(500).json({ error: "Config not found" });}
    // Write to top-level bindings (matching the actual config structure)
    config.bindings = bindings;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    logActivity("system", null, `Updated routing bindings (${bindings.length} rules)`);
    let reloadStatus = 'restart-required';
    try {
      const reloaded = await tryHotReloadGateway(config);
      reloadStatus = reloaded ? 'applied' : 'restart-required';
    } catch {
      reloadStatus = 'restart-required';
    }
    res.json({ ok: true, count: bindings.length, reloadStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Redact sensitive keys from a flat config object */
function redactConfig(obj) {
  if (!obj || typeof obj !== "object") {return {};}
  const safe = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      safe[key] = "***";
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      safe[key] = redactConfig(val);
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

// Channel-type plugin IDs that should also appear in the channels list
const CHANNEL_PLUGIN_IDS = new Set(["voice-call"]);

// Human-readable names for plugin channels
const PLUGIN_CHANNEL_NAMES = {
  "voice-call": "Phone Line (Telnyx)",
};

// GET /channels — list channels (sensitive fields redacted) + plugin channels
router.get("/channels", (req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) {return res.json({ channels: [] });}
    const channels = [];

    // Core channels from config.channels
    for (const [id, ch] of Object.entries(config.channels || {})) {
      const safeConfig = redactConfig(ch.config || {});
      channels.push({
        id,
        name: id,
        type: ch.type || id,
        enabled: ch.enabled !== false,
        dmPolicy: ch.dmPolicy || null,
        config: safeConfig,
        source: "core",
      });
    }

    // Plugin-based channels (e.g., voice-call)
    for (const [pluginId, entry] of Object.entries(config.plugins?.entries || {})) {
      if (!CHANNEL_PLUGIN_IDS.has(pluginId)) {continue;}
      // Don't add duplicates if it already exists as a core channel
      if (channels.some((c) => c.id === pluginId)) {continue;}
      const pluginConfig = entry.config || {};
      const safeConfig = redactConfig(pluginConfig);
      channels.push({
        id: pluginId,
        name: PLUGIN_CHANNEL_NAMES[pluginId] || pluginId,
        type: "voice",
        enabled: entry.enabled !== false,
        dmPolicy: pluginConfig.inboundPolicy || null,
        fromNumber: pluginConfig.fromNumber || null,
        provider: pluginConfig.provider || null,
        config: safeConfig,
        source: "plugin",
      });
    }

    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /channels/:id — single channel details (core + plugin)
router.get("/channels/:channelId", (req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) {return res.status(500).json({ error: "Config not found" });}
    const { channelId } = req.params;

    // Check core channels first
    const ch = config.channels?.[channelId];
    if (ch) {
      const safeConfig = redactConfig(ch.config || {});
      return res.json({
        id: channelId,
        type: ch.type || channelId,
        enabled: ch.enabled !== false,
        dmPolicy: ch.dmPolicy || null,
        allowFrom: ch.allowFrom || [],
        groupPolicy: ch.groupPolicy || null,
        config: safeConfig,
        source: "core",
      });
    }

    // Check plugin channels
    const pluginEntry = config.plugins?.entries?.[channelId];
    if (pluginEntry && CHANNEL_PLUGIN_IDS.has(channelId)) {
      const pluginConfig = pluginEntry.config || {};
      const safeConfig = redactConfig(pluginConfig);
      return res.json({
        id: channelId,
        name: PLUGIN_CHANNEL_NAMES[channelId] || channelId,
        type: "voice",
        enabled: pluginEntry.enabled !== false,
        provider: pluginConfig.provider || null,
        fromNumber: pluginConfig.fromNumber || null,
        toNumber: pluginConfig.toNumber || null,
        inboundPolicy: pluginConfig.inboundPolicy || null,
        allowFrom: pluginConfig.allowFrom || [],
        maxDurationSeconds: pluginConfig.maxDurationSeconds || null,
        config: safeConfig,
        source: "plugin",
      });
    }

    return res.status(404).json({ error: `Channel '${channelId}' not found` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /channels/:id — toggle channel enabled/disabled (core + plugin)
router.patch("/channels/:channelId", async (req, res) => {
  try {
    const configPath = join(CONFIG_DIR, "openclaw.json");
    const config = readJsonFile(configPath);
    if (!config) {return res.status(500).json({ error: "Config not found" });}
    const { channelId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    // Check core channels first
    if (config.channels?.[channelId]) {
      config.channels[channelId].enabled = enabled;
    } else if (config.plugins?.entries?.[channelId] && CHANNEL_PLUGIN_IDS.has(channelId)) {
      // Plugin channel
      config.plugins.entries[channelId].enabled = enabled;
    } else {
      return res.status(404).json({ error: `Channel '${channelId}' not found` });
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    let reloadStatus = 'restart-required';
    try {
      const reloaded = await tryHotReloadGateway(config);
      reloadStatus = reloaded ? 'applied' : 'restart-required';
    } catch {
      reloadStatus = 'restart-required';
    }
    logActivity("system", null, `Channel ${channelId} ${enabled ? "enabled" : "disabled"}`);
    res.json({ ok: true, channelId, enabled, reloadStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /settings/plugins/:pluginId — update plugin config (non-sensitive fields)
router.post("/settings/plugins/:pluginId", async (req, res) => {
  try {
    const configPath = join(CONFIG_DIR, "openclaw.json");
    const config = readJsonFile(configPath);
    if (!config) {return res.status(500).json({ error: "Config not found" });}

    const { pluginId } = req.params;
    const pluginEntry = config.plugins?.entries?.[pluginId];
    if (!pluginEntry) {return res.status(404).json({ error: `Plugin '${pluginId}' not found` });}

    const updates = req.body;
    // Merge non-sensitive updates into plugin config
    pluginEntry.config = pluginEntry.config || {};
    for (const [key, val] of Object.entries(updates)) {
      if (!SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        pluginEntry.config[key] = val;
      }
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const reloaded = await tryHotReloadGateway(config);
    logActivity("system", null, `Plugin ${pluginId} config updated`);
    res.json({ ok: true, reloadStatus: reloaded ? 'applied' : 'restart-required' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /usage — AI model usage data
router.get("/usage", async (req, res) => {
  try {
    const params = {};
    const days = parseInt(req.query.days) || 30;
    if (req.query.startDate && req.query.endDate) {
      params.startDate = req.query.startDate;
      params.endDate = req.query.endDate;
    } else {
      const now = new Date();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const start = new Date(end.getTime() - (days - 1) * 86400000);
      params.startDate = start.toISOString().slice(0, 10);
      params.endDate = end.toISOString().slice(0, 10);
    }
    params.limit = parseInt(req.query.limit) || 500;
    const result = await rpcCall("sessions.usage", params, 60_000);
    res.json(result || { sessions: [], totals: {}, aggregates: {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sessions — list gateway sessions
router.get("/sessions", async (req, res) => {
  try {
    const params = {
      limit: 100,
      activeMinutes: 1440,
      includeLastMessage: true,
      includeDerivedTitles: true,
    };
    if (req.query.agentId) {params.agentId = req.query.agentId;}
    const result = await rpcCall("sessions.list", params);
    res.json(result || { sessions: [] });
  } catch (err) {
    res.json({ sessions: [], error: err.message });
  }
});

// GET /sessions/:key/transcript — session message history
// Reads transcript JSONL files directly since no gateway RPC method exists for full history.
router.get("/sessions/:key/transcript", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);

    // Resolve session to find sessionId and agentId
    let sessionEntry = null;
    try {
      const result = await rpcCall("sessions.list", { limit: 500, includeLastMessage: false }, 10_000);
      sessionEntry = (result?.sessions || []).find((s) => s.key === key);
    } catch {
      // Fallback: parse key to extract agentId (format: "agent:{agentId}:{name}")
    }

    // Extract agentId from key (format: "agent:{agentId}:{name}")
    const keyParts = key.split(":");
    const agentId = keyParts.length >= 2 ? keyParts[1] : null;
    const sessionId = sessionEntry?.sessionId;

    if (!sessionId || !agentId) {
      return res.json({ messages: [], error: "Could not resolve session" });
    }

    // Read transcript JSONL file
    const sessionsDir = join(CONFIG_DIR, "agents", agentId, "sessions");
    const transcriptPath = join(sessionsDir, `${sessionId}.jsonl`);

    if (!existsSync(transcriptPath)) {
      return res.json({ messages: [], error: "Transcript file not found" });
    }

    const content = readFileSync(transcriptPath, "utf-8");
    const messages = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) {continue;}
      try {
        const parsed = JSON.parse(line);
        if (parsed?.message) {
          messages.push(parsed.message);
        }
      } catch {
        // skip malformed lines
      }
    }

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions/:key/reset — reset a session
router.post("/sessions/:key/reset", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    await rpcCall("sessions.reset", { key });
    logActivity("system", null, `Session reset: ${key.substring(0, 50)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sessions/:key — delete a session
router.delete("/sessions/:key", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    await rpcCall("sessions.delete", { key });
    logActivity("system", null, `Session deleted: ${key.substring(0, 50)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
