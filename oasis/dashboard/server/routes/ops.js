/**
 * OASIS Dashboard v3 - Ops Check Route
 * Trigger and track /oasis-ops skill execution with progress.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const router = Router();

// In-memory tracking of the current ops run
let currentOps = null;

// POST /trigger — start an ops check
router.post("/trigger", (_req, res) => {
  if (currentOps && currentOps.status === "running") {
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

  currentOps = {
    id,
    status: "running",
    output: "",
    startedAt: new Date().toISOString(),
    exitCode: null,
    error: null,
  };

  child.stdout.on("data", (d) => {
    output += d.toString();
    if (currentOps) {currentOps.output = output;}
  });

  child.stderr.on("data", (d) => {
    errorOutput += d.toString();
  });

  child.on("close", (code) => {
    if (currentOps && currentOps.id === id) {
      currentOps.status = code === 0 ? "complete" : "failed";
      currentOps.exitCode = code;
      currentOps.completedAt = new Date().toISOString();
      if (errorOutput) {currentOps.error = errorOutput.substring(0, 5000);}
    }
  });

  child.on("error", (err) => {
    if (currentOps && currentOps.id === id) {
      currentOps.status = "failed";
      currentOps.error = err.message;
    }
  });

  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type: "system", agent: null, message: "Ops check triggered" },
    });
  }

  res.json({ ok: true, id, status: "running" });
});

// GET /status — poll current ops check progress
router.get("/status", (_req, res) => {
  if (!currentOps) {return res.json({ status: "idle" });}
  res.json({
    id: currentOps.id,
    status: currentOps.status,
    output: (currentOps.output || "").substring(0, 50000),
    startedAt: currentOps.startedAt,
    completedAt: currentOps.completedAt || null,
    exitCode: currentOps.exitCode,
    error: currentOps.error,
  });
});

export default router;
