/**
 * OASIS Dashboard v3 - Health Routes
 * GET /api/health — gateway status, uptime, version
 * GET /api/system — detailed system/container info
 */

import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { rpcCall } from "../services/gateway-client.js";
import { dockerRequest } from "../utils/docker-client.js";

const router = Router();

const AUTH_USER = process.env.OPENCLAW_DASHBOARD_USERNAME || "";
const AUTH_PASS = process.env.OPENCLAW_DASHBOARD_PASSWORD || "";
const GATEWAY_CONTAINER = process.env.GATEWAY_CONTAINER || "oasis";

router.get("/health", async (req, res) => {
  const isAuthed = (req.headers.authorization || "").startsWith("Basic ");
  try {
    const result = await rpcCall("health");

    if (isAuthed) {
      const decoded = Buffer.from(req.headers.authorization.slice(6), "base64").toString();
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
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
        if (userOk && passOk) {
          // Extract commonly-used gateway data at the top level for the dashboard topbar
          // Gateway health RPC returns sessions as { count, recent, path } — extract the count
          const sessionsObj = result?.sessions;
          const sessionCount = typeof sessionsObj === "number" ? sessionsObj : (sessionsObj?.count ?? 0);
          // Uptime from gateway container via Docker API
          let containerUptime = 0;
          try {
            const cInfo = await dockerRequest(`/containers/${GATEWAY_CONTAINER}/json`);
            if (cInfo.statusCode === 200) {
              const info = JSON.parse(cInfo.body.toString("utf-8"));
              const startedAt = info.State?.StartedAt;
              if (startedAt) {
                const startedMs = new Date(startedAt).getTime();
                if (!isNaN(startedMs) && startedMs > 0) {
                  containerUptime = Math.floor((Date.now() - startedMs) / 1000);
                }
              }
            }
          } catch {}
          const agentCount = Array.isArray(result?.agents) ? result.agents.length : 0;

          // Docker connectivity check
          let dockerConnected = false;
          try {
            const ping = await dockerRequest("/_ping");
            dockerConnected = ping.statusCode === 200;
          } catch {}

          // Gateway token presence
          const gatewayTokenPresent = !!(process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN);

          // WS clients count
          const wsClients = global.dashboardWs?.getClientCount?.() ?? 0;

          // Memory
          const mem = process.memoryUsage();

          return res.json({
            status: "ok",
            uptime: containerUptime,
            dashboardUptime: Math.floor(process.uptime()),
            sessions: sessionCount,
            agents: agentCount,
            version: result?.version || "",
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            dockerConnected,
            gatewayTokenPresent,
            wsClients,
            memory: {
              rss: Math.round(mem.rss / 1024 / 1024),
              heap: Math.round(mem.heapUsed / 1024 / 1024),
            },
            gateway: result,
          });
        }
      }
    }

    // Minimal response for unauthenticated Docker healthchecks
    res.json({ status: "ok" });
  } catch {
    res.json({ status: "degraded" });
  }
});

router.get("/system", async (_req, res) => {
  try {
    const health = await rpcCall("health");
    const mem = process.memoryUsage();

    // Gateway container uptime from Docker API
    let containerUptime = null;
    try {
      const containerInfo = await dockerRequest(`/containers/${GATEWAY_CONTAINER}/json`);
      if (containerInfo.statusCode === 200) {
        const info = JSON.parse(containerInfo.body.toString("utf-8"));
        const startedAt = info.State?.StartedAt;
        if (startedAt) {
          const startedMs = new Date(startedAt).getTime();
          if (!isNaN(startedMs) && startedMs > 0) {
            containerUptime = Math.floor((Date.now() - startedMs) / 1000);
          }
        }
      }
    } catch (dockerErr) {
      console.error("[system] Docker gateway uptime fetch failed:", dockerErr.message);
    }

    // Dashboard container uptime
    let dashboardContainerUptime = null;
    try {
      const dInfo = await dockerRequest("/containers/oasis-dashboard/json");
      if (dInfo.statusCode === 200) {
        const info = JSON.parse(dInfo.body.toString("utf-8"));
        const startedAt = info.State?.StartedAt;
        if (startedAt) {
          const startedMs = new Date(startedAt).getTime();
          if (!isNaN(startedMs) && startedMs > 0) {
            dashboardContainerUptime = Math.floor((Date.now() - startedMs) / 1000);
          }
        }
      }
    } catch {}

    res.json({
      nodeVersion: process.version,
      dashboard: {
        uptime: process.uptime(),
        containerUptime: dashboardContainerUptime,
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heap: Math.round(mem.heapUsed / 1024 / 1024),
        },
      },
      containerUptime: containerUptime ?? null,
      gateway: health,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
