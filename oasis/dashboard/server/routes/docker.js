/**
 * OASIS Dashboard v3 - Docker Routes
 * Container management: list, stop/start/restart, restart-all, rebuild, logs.
 */

import { Router } from "express";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { dockerRequest, dockerStatsRequest, dockerPost, parseDockerLogs } from "../utils/docker-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const router = Router();

const MANAGED_CONTAINERS = ["oasis", "oasis-dashboard", "docker-proxy", "audio-listener"];
const SKIP_ON_RESTART_ALL = new Set(["oasis-dashboard", "docker-proxy"]);

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

/** Parse raw Docker stats JSON into { cpuPercent, memUsageMb, memLimitMb, memPercent }. */
function parseStats(stats) {
  let cpuPercent = 0, memUsageMb = 0, memLimitMb = 0, memPercent = 0;
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage || 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage || 0) -
    (stats.precpu_stats?.system_cpu_usage || 0);
  const numCpus = stats.cpu_stats?.online_cpus || 1;
  if (systemDelta > 0 && cpuDelta >= 0) {
    cpuPercent = Math.round((cpuDelta / systemDelta) * numCpus * 10000) / 100;
  }
  memUsageMb = Math.round((stats.memory_stats?.usage || 0) / 1048576);
  memLimitMb = Math.round((stats.memory_stats?.limit || 0) / 1048576);
  if (memLimitMb > 0) {
    memPercent = Math.round((memUsageMb / memLimitMb) * 10000) / 100;
  }
  return { cpuPercent, memUsageMb, memLimitMb, memPercent };
}

// GET /containers — list all managed containers with CPU/memory stats
router.get("/containers", async (_req, res) => {
  try {
    // Quick connectivity check — ping the Docker API before doing real work
    try {
      const ping = await dockerRequest("/_ping");
      if (ping.statusCode !== 200) {
        return res.json({ containers: [], error: "Docker API unreachable" });
      }
    } catch {
      return res.json({ containers: [], error: "Docker API unreachable" });
    }

    // Phase 1: fetch container info for all containers in parallel
    const infoResults = await Promise.allSettled(
      MANAGED_CONTAINERS.map(async (name) => {
        const result = await dockerRequest(`/containers/${name}/json`);
        return { name, result };
      }),
    );

    // Phase 2: fetch stats in parallel for running containers (stats?stream=false is slow)
    const runningContainers = [];
    const containerInfoMap = new Map();

    for (const entry of infoResults) {
      if (entry.status !== "fulfilled") {continue;}
      const { name, result } = entry.value;
      if (result.statusCode !== 200) {continue;}
      const info = JSON.parse(result.body.toString());
      containerInfoMap.set(name, info);
      if (info.State?.Status === "running") {
        runningContainers.push(name);
      }
    }

    const statsMap = new Map();
    const statsResults = await Promise.allSettled(
      runningContainers.map(async (name) => {
        const statsResult = await dockerStatsRequest(`/containers/${name}/stats?stream=false`);
        return { name, statsResult };
      }),
    );

    for (const entry of statsResults) {
      if (entry.status !== "fulfilled") {continue;}
      const { name, statsResult } = entry.value;
      if (statsResult.statusCode === 200) {
        try {
          const stats = JSON.parse(statsResult.body.toString());
          statsMap.set(name, parseStats(stats));
        } catch {
          // malformed stats JSON — skip
        }
      }
    }

    // Phase 3: assemble response
    const containers = [];
    for (const name of MANAGED_CONTAINERS) {
      const info = containerInfoMap.get(name);
      if (!info) {
        // Container info fetch failed or returned non-200
        const infoEntry = infoResults.find(
          (e) => e.status === "fulfilled" && e.value.name === name,
        );
        if (infoEntry) {
          containers.push({ name, status: "not_found", health: "none" });
        } else {
          containers.push({ name, status: "error", health: "none" });
        }
        continue;
      }

      const startedAt = info.State?.StartedAt;
      const uptimeMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;
      const health = info.State?.Health?.Status || "none";
      const statsData = statsMap.get(name);
      const statsAvailable = !!statsData;
      const { cpuPercent, memUsageMb, memLimitMb, memPercent } =
        statsData || { cpuPercent: 0, memUsageMb: 0, memLimitMb: 0, memPercent: 0 };

      containers.push({
        name,
        status: info.State?.Status || "unknown",
        health,
        startedAt,
        uptimeMs,
        image: info.Config?.Image || "unknown",
        cpuPercent,
        memUsageMb,
        memLimitMb,
        memPercent,
        statsAvailable,
        restartCount: info.RestartCount || 0,
        ports: Object.keys(info.NetworkSettings?.Ports || {}),
      });
    }
    res.json({ containers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /containers/:name/stop
router.post("/containers/:name/stop", async (req, res) => {
  const { name } = req.params;
  if (!MANAGED_CONTAINERS.includes(name)) {
    return res.status(400).json({ error: `Unknown container: ${name}` });
  }
  if (name === "oasis-dashboard" || name === "docker-proxy") {
    return res.status(400).json({ error: `Cannot stop ${name} — dashboard depends on it` });
  }
  try {
    const result = await dockerPost(`/containers/${name}/stop?t=10`);
    if (result.statusCode === 204 || result.statusCode === 304) {
      logActivity("system", "oasis", `Container stopped: ${name}`);
      res.json({ ok: true, action: "stop", container: name });
    } else {
      res.status(502).json({ error: `Docker API returned ${result.statusCode}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /containers/:name/start
router.post("/containers/:name/start", async (req, res) => {
  const { name } = req.params;
  if (!MANAGED_CONTAINERS.includes(name)) {
    return res.status(400).json({ error: `Unknown container: ${name}` });
  }
  try {
    const result = await dockerPost(`/containers/${name}/start`);
    if (result.statusCode === 204 || result.statusCode === 304) {
      logActivity("system", "oasis", `Container started: ${name}`);
      res.json({ ok: true, action: "start", container: name });
    } else {
      res.status(502).json({ error: `Docker API returned ${result.statusCode}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /containers/:name/restart
router.post("/containers/:name/restart", async (req, res) => {
  const { name } = req.params;
  if (!MANAGED_CONTAINERS.includes(name)) {
    return res.status(400).json({ error: `Unknown container: ${name}` });
  }
  try {
    const result = await dockerPost(`/containers/${name}/restart?t=10`);
    if (result.statusCode === 204) {
      logActivity("system", "oasis", `Container restarted: ${name}`);
      res.json({ ok: true, action: "restart", container: name });
    } else {
      res.status(502).json({ error: `Docker API returned ${result.statusCode}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /restart-all — restart all non-infra containers
router.post("/restart-all", async (_req, res) => {
  const results = [];
  for (const name of MANAGED_CONTAINERS) {
    if (SKIP_ON_RESTART_ALL.has(name)) {continue;}
    try {
      const result = await dockerPost(`/containers/${name}/restart?t=10`);
      results.push({ name, ok: result.statusCode === 204 });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }
  logActivity("system", "oasis", "All containers restarted");
  res.json({ ok: true, results });
});

// POST /rebuild — trigger the weekly update/rebuild script
router.post("/rebuild", (_req, res) => {
  try {
    const scriptPath = process.env.OASIS_UPDATE_SCRIPT || resolve(__dirname, "../../scripts/oasis-weekly-update.sh");
    const child = spawn(scriptPath, [], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" },
    });
    child.unref();
    logActivity("system", "oasis", "Docker rebuild triggered from dashboard");
    res.json({ ok: true, message: "Rebuild started. Check update logs for progress." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /logs/:containerName — fetch container logs
router.get("/logs/:containerName", async (req, res) => {
  const { containerName } = req.params;
  const tail = Math.min(parseInt(req.query.tail) || 200, 1000);
  const since = (req.query.since || "").replace(/[^0-9T:.Z-]/g, "");

  // Allow logs for any known container
  const allowedLogContainers = [...MANAGED_CONTAINERS];
  if (!allowedLogContainers.includes(containerName)) {
    return res.status(400).json({ error: `Unknown container: ${containerName}` });
  }

  try {
    let path = `/containers/${containerName}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`;
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

export default router;
