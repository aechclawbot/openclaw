/**
 * OASIS Dashboard v3 - Feature Requests Routes (NEW)
 * Manage feature requests with Claude Code planning and execution.
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const router = Router();
const FEATURES_FILE = join(process.env.HOME || "/root", ".openclaw", "feature-requests.json");

/**
 * Run /oasis-ops skill after Claude Code execution completes.
 * Fire-and-forget: errors are logged but don't block the caller.
 */
function runOasisOps(context) {
  const label = context || "post-execution";
  console.log(`[oasis-ops] Triggering /oasis-ops after ${label}`);
  const child = spawn("claude", ["-p", "/oasis-ops"], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  child.on("close", (code) => {
    console.log(`[oasis-ops] Completed after ${label} (exit ${code})`);
  });
  child.on("error", (err) => {
    console.error(`[oasis-ops] Failed after ${label}: ${err.message}`);
  });
}

// Active progress streams: { requestId -> { res, child } }
const progressStreams = new Map();

function readFeatures() {
  try {
    if (!existsSync(FEATURES_FILE)) {return [];}
    return JSON.parse(readFileSync(FEATURES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeFeatures(features) {
  // Ensure parent directory exists
  const dir = FEATURES_FILE.substring(0, FEATURES_FILE.lastIndexOf("/"));
  if (!existsSync(dir)) {mkdirSync(dir, { recursive: true });}
  writeFileSync(FEATURES_FILE, JSON.stringify(features, null, 2));
}

// POST / — create feature request
router.post("/", (req, res) => {
  const { title, description, priority, requester } = req.body;
  if (!title || !title.trim()) {return res.status(400).json({ error: "title is required" });}

  const features = readFeatures();
  const feature = {
    id: randomUUID(),
    title: title.trim(),
    description: (description || "").trim() || null,
    priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
    requester: requester || "dashboard",
    status: "pending",
    plan: null,
    planApproved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  features.unshift(feature);
  writeFeatures(features);
  res.json({ ok: true, feature });
});

// GET / — list all feature requests
router.get("/", (_req, res) => {
  res.json({ features: readFeatures() });
});

// POST /ops-check — manually trigger /oasis-ops skill
router.post("/ops-check", (_req, res) => {
  try {
    runOasisOps("manual-dashboard-trigger");
    res.json({ ok: true, message: "Ops check triggered" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — single feature request
router.get("/:id", (req, res) => {
  const features = readFeatures();
  const feature = features.find((f) => f.id === req.params.id);
  if (!feature) {return res.status(404).json({ error: "Feature request not found" });}
  res.json({ feature });
});

// PUT /:id — update feature request
router.put("/:id", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}

  const allowedFields = ["title", "description", "priority", "status"];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {features[idx][field] = req.body[field];}
  }
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);
  res.json({ ok: true, feature: features[idx] });
});

// POST /:id/plan — trigger Claude Code planning
router.post("/:id/plan", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}

  const feature = features[idx];
  features[idx].status = "planning";
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);

  const prompt = `Create an implementation plan for the following feature request for the OASIS dashboard system:

Title: ${feature.title}
Description: ${feature.description || "No description provided"}
Priority: ${feature.priority}

Provide a detailed plan including:
1. Files to create or modify
2. Implementation approach
3. Estimated complexity (low/medium/high)
4. Potential risks or considerations
5. Step-by-step implementation steps

Be concise and specific. Focus on actionable steps.`;

  let output = "";

  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => { output += d.toString(); });
  child.stderr.on("data", () => {});

  child.on("close", (code) => {
    const feats = readFeatures();
    const i = feats.findIndex((f) => f.id === req.params.id);
    if (i !== -1) {
      feats[i].plan = output;
      feats[i].planGeneratedAt = new Date().toISOString();
      feats[i].status = code === 0 ? "awaiting_approval" : "planning_failed";
      feats[i].updatedAt = new Date().toISOString();
      writeFeatures(feats);
    }
    runOasisOps(`feature-plan:${feature.title.substring(0, 40)}`);
  });

  child.on("error", (err) => {
    const feats = readFeatures();
    const i = feats.findIndex((f) => f.id === req.params.id);
    if (i !== -1) {
      feats[i].status = "planning_failed";
      feats[i].planError = err.message;
      feats[i].updatedAt = new Date().toISOString();
      writeFeatures(feats);
    }
  });

  res.json({ ok: true, status: "planning", featureId: feature.id });
});

// PUT /:id/approve — approve a plan
router.put("/:id/approve", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}
  if (!features[idx].plan) {return res.status(400).json({ error: "No plan to approve" });}

  features[idx].planApproved = true;
  features[idx].approvedAt = new Date().toISOString();
  features[idx].status = "approved";
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);
  res.json({ ok: true, feature: features[idx] });
});

// POST /:id/execute — execute approved plan
router.post("/:id/execute", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}
  if (!features[idx].planApproved) {return res.status(400).json({ error: "Plan must be approved before execution" });}

  const feature = features[idx];
  features[idx].status = "executing";
  features[idx].executionStartedAt = new Date().toISOString();
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);

  const prompt = `Execute the following feature request implementation plan for the OASIS dashboard:

Feature: ${feature.title}
Plan:
${feature.plan}

Implement this feature now. Make all necessary file changes. Report what was created/modified.`;

  let output = "";
  let errorOutput = "";

  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Store child for progress streaming
  progressStreams.set(feature.id, { child, output: "" });

  child.stdout.on("data", (d) => {
    output += d.toString();
    const entry = progressStreams.get(feature.id);
    if (entry) {
      entry.output = output;
      // Broadcast to SSE clients if any are listening
      if (entry.res) {
        entry.res.write(`data: ${JSON.stringify({ type: "progress", text: d.toString() })}\n\n`);
      }
    }
  });

  child.stderr.on("data", (d) => { errorOutput += d.toString(); });

  child.on("close", (code) => {
    const feats = readFeatures();
    const i = feats.findIndex((f) => f.id === feature.id);
    if (i !== -1) {
      feats[i].status = code === 0 ? "completed" : "failed";
      feats[i].executionOutput = output;
      feats[i].completedAt = new Date().toISOString();
      feats[i].updatedAt = new Date().toISOString();
      writeFeatures(feats);
    }
    const entry = progressStreams.get(feature.id);
    if (entry?.res) {
      entry.res.write(`data: ${JSON.stringify({ type: "done", exitCode: code })}\n\n`);
      entry.res.end();
    }
    progressStreams.delete(feature.id);
    runOasisOps(`feature-execute:${feature.title.substring(0, 40)}`);
  });

  child.on("error", (err) => {
    const feats = readFeatures();
    const i = feats.findIndex((f) => f.id === feature.id);
    if (i !== -1) {
      feats[i].status = "failed";
      feats[i].executionError = err.message;
      feats[i].updatedAt = new Date().toISOString();
      writeFeatures(feats);
    }
    progressStreams.delete(feature.id);
  });

  res.json({ ok: true, status: "executing", featureId: feature.id });
});

// GET /:id/progress — SSE progress stream
router.get("/:id/progress", (req, res) => {
  const { id } = req.params;
  const features = readFeatures();
  const feature = features.find((f) => f.id === id);
  if (!feature) {return res.status(404).json({ error: "Feature request not found" });}

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const entry = progressStreams.get(id);
  if (!entry) {
    // No active execution — return current status
    res.write(`data: ${JSON.stringify({ type: "status", status: feature.status })}\n\n`);
    if (feature.executionOutput) {
      res.write(`data: ${JSON.stringify({ type: "progress", text: feature.executionOutput })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
    return;
  }

  // Attach to live execution
  entry.res = res;

  // Send buffered output so far
  if (entry.output) {
    res.write(`data: ${JSON.stringify({ type: "progress", text: entry.output })}\n\n`);
  }

  req.on("close", () => {
    const e = progressStreams.get(id);
    if (e) {e.res = null;}
  });
});

// PUT /:id/reject — reject a plan
router.put("/:id/reject", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}

  features[idx].planApproved = false;
  features[idx].status = "rejected";
  features[idx].rejectedAt = new Date().toISOString();
  features[idx].rejectionReason = req.body.reason || null;
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);
  res.json({ ok: true, feature: features[idx] });
});

// PUT /:id/complete — mark feature as complete
router.put("/:id/complete", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}

  features[idx].status = "completed";
  features[idx].completedAt = new Date().toISOString();
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);
  res.json({ ok: true, feature: features[idx] });
  // Auto-trigger ops check after feature completion
  try { runOasisOps("auto-post-execution"); } catch {}
});

// PUT /:id/issues — report issues with a feature implementation
router.put("/:id/issues", (req, res) => {
  const features = readFeatures();
  const idx = features.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {return res.status(404).json({ error: "Feature request not found" });}

  features[idx].status = "issues_reported";
  features[idx].issues = req.body.notes || req.body.issues || null;
  features[idx].issuesReportedAt = new Date().toISOString();
  features[idx].updatedAt = new Date().toISOString();
  writeFeatures(features);
  res.json({ ok: true, feature: features[idx] });
  // Auto-trigger ops check after issues reported
  try { runOasisOps("auto-post-execution"); } catch {}
});

export default router;
