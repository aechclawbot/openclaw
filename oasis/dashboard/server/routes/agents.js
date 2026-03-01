/**
 * OASIS Dashboard v3 - Agents Routes
 */

import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { rpcCall } from "../services/gateway-client.js";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";

const WORKSPACE_EDITABLE_FILES = new Set([
  "IDENTITY.md", "SOUL.md", "TOOLS.md", "DIRECTIVES.md",
  "CONTACTS.md", "USER.md", "MEMORY.md",
]);

const WORKSPACE_FILE_EXTENSIONS = [".md", ".json", ".yaml", ".yml", ".txt"];

function getFileType(filename) {
  if (filename.endsWith(".json")) return "json";
  if (filename.endsWith(".yaml") || filename.endsWith(".yml")) return "yaml";
  if (filename.endsWith(".txt")) return "txt";
  if (filename.endsWith(".md")) return "markdown";
  return "unknown";
}

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function logActivity(type, agent, message, details = {}) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message, ...details },
    });
  }
}

// GET / — list agents from config
router.get("/", (_req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) return res.json({ agents: [], error: "Config not found" });
    const defaultModel = config.agents?.defaults?.model || null;
    const agents = (config.agents?.list || []).map((a) => ({
      id: a.id,
      name: a.name || a.identity?.name || a.id,
      emoji: a.identity?.emoji || "",
      theme: a.identity?.theme || "",
      tools: a.tools?.allow || [],
      workspace: a.workspace,
      model: a.model || null,
    }));
    res.json({ agents, defaultModel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — single agent
router.get("/:id", (req, res) => {
  try {
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    if (!config) return res.status(500).json({ error: "Config not found" });
    const agent = (config.agents?.list || []).find((a) => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/model — change model + fallback chain
router.put("/:id/model", (req, res) => {
  try {
    const { primary, fallbacks } = req.body;
    if (!primary && !Array.isArray(fallbacks)) {
      return res.status(400).json({ error: "primary or fallbacks is required" });
    }
    const configPath = join(CONFIG_DIR, "openclaw.json");
    const config = readJsonFile(configPath);
    if (!config) return res.status(500).json({ error: "Config not found" });
    const agent = (config.agents?.list || []).find((a) => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const existingPrimary = agent.model?.primary || "";
    const existingFallbacks = agent.model?.fallbacks || [];
    agent.model = {
      primary: primary || existingPrimary,
      fallbacks: Array.isArray(fallbacks) ? fallbacks : existingFallbacks,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const changes = [];
    if (primary) changes.push(`primary → ${primary}`);
    if (Array.isArray(fallbacks)) changes.push(`fallbacks → [${fallbacks.join(", ")}]`);
    logActivity("system", req.params.id, `Model changed: ${changes.join(", ")}`);
    // Hot-reload via gateway (best effort)
    rpcCall("config.patch", { path: "agents.list", value: config.agents.list }).catch(() => {});
    res.json({ ok: true, model: agent.model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/message — send message, return response
router.post("/:id/message", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: "message is required" });
  try {
    const idempotencyKey = randomUUID();
    const result = await rpcCall(
      "agent",
      { agentId: req.params.id, message, idempotencyKey, deliver: false },
      120_000
    );
    logActivity("agent_message", req.params.id, message.substring(0, 100));
    res.json({ ok: true, runId: result?.runId || idempotencyKey, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /:id/clear-memory — clear agent memory
router.post("/:id/clear-memory", async (req, res) => {
  try {
    const { scope } = req.body || {};
    if (!scope || !["sessions", "full"].includes(scope)) {
      return res.status(400).json({ error: "scope must be 'sessions' or 'full'" });
    }
    const agentId = req.params.id;
    const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
    const agent = (config?.agents?.list || []).find((a) => a.id === agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Clear sessions via RPC
    try {
      await rpcCall("sessions.deleteByAgent", { agentId }, 15_000);
    } catch {
      // Fallback: list and delete individually
      try {
        const sessData = await rpcCall("sessions.list", { limit: 500 });
        const sessions = sessData?.sessions || [];
        for (const s of sessions) {
          const key = s.key || "";
          if (key.startsWith(`agent:${agentId}:`)) {
            await rpcCall("sessions.delete", { key }).catch(() => {});
          }
        }
      } catch {}
    }

    // Full reset: also clear workspace memory files
    if (scope === "full") {
      const workspaceDir = join(CONFIG_DIR, `workspace-${agentId}`);
      if (existsSync(workspaceDir)) {
        const memoryFiles = ["memory.md", "context.md", "notes.md", "scratchpad.md"];
        for (const f of memoryFiles) {
          const fpath = join(workspaceDir, f);
          if (existsSync(fpath)) writeFileSync(fpath, "");
        }
      }
    }

    logActivity("system", agentId, `Memory cleared (${scope})`);
    res.json({ ok: true, cleared: scope });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/workspace/files — list workspace files
router.get("/:id/workspace/files", (req, res) => {
  try {
    const agentId = req.params.id;
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }
    const workspaceDir = join(CONFIG_DIR, `workspace-${agentId}`);
    if (!existsSync(workspaceDir)) return res.json({ files: [], agentId });
    const entries = readdirSync(workspaceDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && WORKSPACE_FILE_EXTENSIONS.some(ext => e.name.endsWith(ext)))
      .map((e) => {
        const content = readFileSync(join(workspaceDir, e.name), "utf-8");
        return {
          name: e.name,
          type: getFileType(e.name),
          editable: WORKSPACE_EDITABLE_FILES.has(e.name),
          size: content.length,
          preview: content.substring(0, 200),
        };
      });
    res.json({ files, agentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/workspace/files/:filename — read file
router.get("/:id/workspace/files/:filename", (req, res) => {
  try {
    const { id: agentId, filename } = req.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }
    if (!/^[A-Za-z0-9_.-]+\.(md|json|yaml|yml|txt)$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const workspaceDir = resolve(join(CONFIG_DIR, `workspace-${agentId}`));
    const filePath = resolve(join(workspaceDir, filename));
    if (!filePath.startsWith(workspaceDir + "/")) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    const content = readFileSync(filePath, "utf-8");
    res.json({ agentId, filename, content, type: getFileType(filename), editable: WORKSPACE_EDITABLE_FILES.has(filename) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/workspace/files/:filename — write file
router.put("/:id/workspace/files/:filename", (req, res) => {
  try {
    const { id: agentId, filename } = req.params;
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: "content is required" });
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }
    if (!WORKSPACE_EDITABLE_FILES.has(filename)) {
      return res.status(403).json({ error: `File '${filename}' is not editable` });
    }
    const workspaceDir = resolve(join(CONFIG_DIR, `workspace-${agentId}`));
    const filePath = resolve(join(workspaceDir, filename));
    if (!filePath.startsWith(workspaceDir + "/")) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!existsSync(workspaceDir)) {return res.status(404).json({ error: "Workspace not found" });}
    writeFileSync(filePath, content);
    logActivity("system", agentId, `Updated workspace file: ${filename}`);
    res.json({ ok: true, agentId, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
