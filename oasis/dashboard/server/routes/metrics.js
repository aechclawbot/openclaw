/**
 * OASIS Dashboard v3 - Metrics Routes
 * Summary, agents, cron, system metrics.
 */

import { Router } from "express";
import { rpcCall } from "../services/gateway-client.js";
import { getMetricsSummary, getAgentMetrics, getCronMetrics, getSystemMetrics } from "../services/metrics-service.js";

const router = Router();

// GET / — metrics index (alias for /summary)
router.get("/", async (_req, res) => {
  try {
    const summary = await getMetricsSummary(rpcCall);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary — combined metrics (sessions + cron + system)
router.get("/summary", async (_req, res) => {
  try {
    const summary = await getMetricsSummary(rpcCall);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /agents — agent-level metrics
router.get("/agents", async (_req, res) => {
  try {
    const metrics = await getAgentMetrics(rpcCall);
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /cron — cron reliability metrics
router.get("/cron", async (_req, res) => {
  try {
    const cronResult = await rpcCall("cron.list", { includeDisabled: true }).catch(() => ({ jobs: [] }));
    const jobs = (cronResult?.jobs || []).map((j) => ({
      id: j.id,
      name: j.name,
      agentId: j.agentId,
      enabled: j.enabled,
      schedule: j.schedule,
      state: j.state,
      lastStatus: j.state?.lastStatus || "never",
      lastRunAt: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : null,
      lastDurationMs: j.state?.lastDurationMs || null,
      consecutiveErrors: j.state?.consecutiveErrors || 0,
    }));
    const metrics = getCronMetrics(jobs);
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /system — system/gateway resource metrics
router.get("/system", async (_req, res) => {
  try {
    const healthResult = await rpcCall("health").catch(() => null);
    const metrics = await getSystemMetrics(
      healthResult ? { status: "ok", gateway: healthResult } : {}
    );
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
