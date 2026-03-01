/**
 * OASIS Dashboard v3 - Cron Routes
 * Full CRUD + toggle + run + history
 */

import { Router } from "express";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { rpcCall } from "../services/gateway-client.js";
import { extractFromScanRun } from "../services/scan-extractor.js";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";

import { readFileSync } from "fs";
function readJsonFileSafe(path) {
  try {
    if (!existsSync(path)) {return null;}
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

function mapJobSummary(j) {
  return {
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
  };
}

// GET / — list cron jobs
router.get("/", async (_req, res) => {
  try {
    const result = await rpcCall("cron.list", { includeDisabled: true });
    res.json({ jobs: (result.jobs || []).map(mapJobSummary) });
  } catch (err) {
    // Fallback to local file
    try {
      const jobs = readJsonFileSafe(join(CONFIG_DIR, "cron", "jobs.json"));
      if (!jobs) {return res.json({ jobs: [] });}
      res.json({ jobs: (jobs.jobs || []).map(mapJobSummary) });
    } catch {
      res.status(500).json({ error: err.message });
    }
  }
});

// GET /:jobId/details — single job details
router.get("/:jobId/details", async (req, res) => {
  try {
    const result = await rpcCall("cron.list", { includeDisabled: true });
    const job = (result.jobs || []).find((j) => j.id === req.params.jobId);
    if (!job) {return res.status(404).json({ error: "Job not found" });}
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create new cron job
router.post("/", async (req, res) => {
  try {
    const { id, name, agentId, schedule, tz, payload, delivery, enabled } = req.body;
    if (!id || !name || !agentId || !schedule) {
      return res.status(400).json({ error: "id, name, agentId, and schedule are required" });
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: "id must be lowercase alphanumeric with hyphens" });
    }
    const job = {
      id,
      name,
      agentId,
      schedule: { expr: schedule, tz: tz || "America/New_York" },
      enabled: enabled !== false,
    };
    if (payload) {job.payload = payload;}
    if (delivery) {job.delivery = delivery;}
    await rpcCall("cron.add", { job });
    logActivity("cron_create", agentId, `Created cron job: ${name} (${schedule})`);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:jobId — update cron job
router.put("/:jobId", async (req, res) => {
  try {
    const patch = {};
    const { name, agentId, schedule, tz, payload, delivery, enabled } = req.body;
    if (name !== undefined) {patch.name = name;}
    if (agentId !== undefined) {patch.agentId = agentId;}
    if (schedule !== undefined || tz !== undefined) {
      patch.schedule = {};
      if (schedule !== undefined) {patch.schedule.expr = schedule;}
      if (tz !== undefined) {patch.schedule.tz = tz;}
    }
    if (payload !== undefined) {patch.payload = payload;}
    if (delivery !== undefined) {patch.delivery = delivery;}
    if (enabled !== undefined) {patch.enabled = enabled;}
    await rpcCall("cron.update", { jobId: req.params.jobId, patch });
    logActivity("cron_update", null, `Updated cron job: ${req.params.jobId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:jobId — delete cron job
router.delete("/:jobId", async (req, res) => {
  try {
    await rpcCall("cron.remove", { jobId: req.params.jobId });
    logActivity("cron_delete", null, `Deleted cron job: ${req.params.jobId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:jobId/toggle — enable/disable cron job
router.post("/:jobId/toggle", async (req, res) => {
  try {
    const list = await rpcCall("cron.list", { includeDisabled: true });
    const job = (list.jobs || []).find((j) => j.id === req.params.jobId);
    if (!job) {return res.status(404).json({ error: "Job not found" });}
    const newEnabled = !job.enabled;
    await rpcCall("cron.update", { jobId: req.params.jobId, patch: { enabled: newEnabled } });
    logActivity("cron_toggle", job.agentId, `${job.name} ${newEnabled ? "enabled" : "disabled"}`);
    res.json({ ok: true, enabled: newEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:jobId/run — trigger cron job immediately
router.post("/:jobId/run", async (req, res) => {
  try {
    const result = await rpcCall("cron.run", { jobId: req.params.jobId, mode: "force" }, 120_000);
    logActivity("cron_run", null, `Manually triggered ${req.params.jobId}`);

    // Extract items from the scan result and merge into agent data files
    let extraction = null;
    try {
      // Fetch the latest run entry for the richest summary
      const history = await rpcCall("cron.runs", { jobId: req.params.jobId, limit: 1 });
      const latest = (history.entries ?? [])[0];
      extraction = extractFromScanRun(req.params.jobId, latest);
      if (extraction?.added > 0) {
        logActivity("scan_extract", extraction.agent,
          `Extracted ${extraction.extracted} items, added ${extraction.added} new`);
      }
    } catch { /* extraction is best-effort */ }

    res.json({ ok: true, result, extraction });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /:jobId/runs — run history
router.get("/:jobId/runs", async (req, res) => {
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

// POST /:jobId/extract — re-extract items from recent scan history
router.post("/:jobId/extract", async (req, res) => {
  try {
    const history = await rpcCall("cron.runs", { jobId: req.params.jobId, limit: 5 });
    const entries = history.entries ?? [];
    let totalExtracted = 0;
    let totalAdded = 0;
    for (const entry of entries) {
      const result = extractFromScanRun(req.params.jobId, entry);
      if (result) {
        totalExtracted += result.extracted;
        totalAdded += result.added;
      }
    }
    if (totalAdded > 0) {
      logActivity("scan_extract", null,
        `Re-extracted from ${req.params.jobId}: ${totalExtracted} items found, ${totalAdded} new`);
    }
    res.json({ ok: true, scanned: entries.length, extracted: totalExtracted, added: totalAdded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
