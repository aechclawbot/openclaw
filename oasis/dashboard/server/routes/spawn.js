/**
 * OASIS Dashboard v3 - Spawn Routes (NEW)
 * Create new agents from dashboard UI.
 * POST / — create new agent
 * GET /validate/:id — check agent ID uniqueness
 * GET /templates — return starter templates
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

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

// GET /validate/:id — check if agent ID is available
router.get("/validate/:id", (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.json({ valid: false, reason: "ID must be alphanumeric with hyphens/underscores only" });
  }
  if (id.length < 2 || id.length > 32) {
    return res.json({ valid: false, reason: "ID must be 2-32 characters" });
  }

  const config = readJsonFile(join(CONFIG_DIR, "openclaw.json"));
  const exists = (config?.agents?.list || []).some((a) => a.id === id);

  if (exists) {
    return res.json({ valid: false, reason: `Agent '${id}' already exists` });
  }

  const workspaceDir = join(CONFIG_DIR, `workspace-${id}`);
  if (existsSync(workspaceDir)) {
    return res.json({ valid: false, reason: `Workspace 'workspace-${id}' already exists` });
  }

  res.json({ valid: true });
});

// GET /templates — return starter agent templates
router.get("/templates", (_req, res) => {
  const templates = [
    {
      id: "assistant",
      name: "General Assistant",
      description: "A helpful general-purpose agent",
      identity: {
        name: "Assistant",
        emoji: "🤖",
        theme: "blue",
      },
      tools: {
        allow: ["group:fs", "group:web", "exec"],
      },
    },
    {
      id: "researcher",
      name: "Researcher",
      description: "Specializes in research and information gathering",
      identity: {
        name: "Researcher",
        emoji: "🔬",
        theme: "purple",
      },
      tools: {
        allow: ["group:web", "group:fs"],
      },
    },
    {
      id: "analyst",
      name: "Data Analyst",
      description: "Analyzes data, files, and system metrics",
      identity: {
        name: "Analyst",
        emoji: "📊",
        theme: "green",
      },
      tools: {
        allow: ["group:fs", "exec"],
      },
    },
    {
      id: "operator",
      name: "System Operator",
      description: "Manages system operations and automation",
      identity: {
        name: "Operator",
        emoji: "⚙️",
        theme: "orange",
      },
      tools: {
        allow: ["group:fs", "exec", "group:web"],
      },
    },
  ];
  res.json({ templates });
});

// POST / — create new agent
router.post("/", (req, res) => {
  try {
    const { id, name, description, emoji, theme, tools, model, identity: rawIdentity, directives } = req.body;

    // Validation
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: "Valid agent ID is required (alphanumeric, hyphens, underscores)" });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Agent name is required" });
    }
    if (id.length < 2 || id.length > 32) {
      return res.status(400).json({ error: "Agent ID must be 2-32 characters" });
    }

    const configPath = join(CONFIG_DIR, "openclaw.json");
    const config = readJsonFile(configPath);
    if (!config) {return res.status(500).json({ error: "Config not found" });}

    // Check uniqueness
    const exists = (config.agents?.list || []).some((a) => a.id === id);
    if (exists) {return res.status(409).json({ error: `Agent '${id}' already exists` });}

    const workspaceDir = join(CONFIG_DIR, `workspace-${id}`);
    if (existsSync(workspaceDir)) {
      return res.status(409).json({ error: `Workspace already exists for '${id}'` });
    }

    // Build agent config entry
    const identity = rawIdentity || {};
    const agentEntry = {
      id,
      name: name.trim(),
      identity: {
        name: identity.name || name.trim(),
        emoji: identity.emoji || emoji || "🤖",
        theme: identity.theme || theme || "blue",
      },
      workspace: `workspace-${id}`,
      tools: {
        allow: tools?.allow || ["group:fs", "group:web"],
      },
    };

    if (model) {
      agentEntry.model = typeof model === "string" ? { primary: model, fallbacks: [] } : model;
    }

    // Add to config
    config.agents = config.agents || {};
    config.agents.list = config.agents.list || [];
    config.agents.list.push(agentEntry);
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create workspace directory
    mkdirSync(workspaceDir, { recursive: true });

    // Generate workspace files
    const agentName = identity.name || name.trim();
    const agentDescription = description || `${agentName} agent for the OASIS system.`;

    writeFileSync(
      join(workspaceDir, "IDENTITY.md"),
      `# ${agentName}\n\nAgent ID: ${id}\n\n${agentDescription}\n`
    );

    writeFileSync(
      join(workspaceDir, "SOUL.md"),
      `# Soul of ${agentName}\n\nCore values and personality traits for ${agentName}.\n\n## Values\n- Helpful\n- Accurate\n- Concise\n\n## Personality\n${agentDescription}\n`
    );

    writeFileSync(
      join(workspaceDir, "DIRECTIVES.md"),
      directives || `# Directives for ${agentName}\n\n## Primary Directive\nAssist with tasks as requested.\n\n## Guidelines\n1. Be helpful and accurate\n2. Ask for clarification when needed\n3. Report errors clearly\n`
    );

    writeFileSync(
      join(workspaceDir, "TOOLS.md"),
      `# Tools Available to ${agentName}\n\n${(tools?.allow || ["group:fs", "group:web"]).map((t) => `- ${t}`).join("\n")}\n`
    );

    writeFileSync(
      join(workspaceDir, "MEMORY.md"),
      `# Memory for ${agentName}\n\n_This file is automatically updated by the agent to track important context._\n`
    );

    res.json({
      ok: true,
      agentId: id,
      workspaceDir,
      agent: agentEntry,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
