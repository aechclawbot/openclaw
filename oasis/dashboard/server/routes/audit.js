/**
 * OASIS Dashboard v3 - Audit Routes (NEW)
 * QA and security audit management using the claude CLI.
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const router = Router();
const AUDIT_REPORTS_DIR = join(process.env.HOME || "/root", ".openclaw", "audit-reports");

// Ensure audit directory exists
if (!existsSync(AUDIT_REPORTS_DIR)) {
  mkdirSync(AUDIT_REPORTS_DIR, { recursive: true });
}

// Track running audits: { id, type, pid, startedAt, status, output }
const runningAudits = new Map();

function readJsonFile(path) {
  try {
    if (!existsSync(path)) {return null;}
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function saveReport(type, report) {
  const dir = join(AUDIT_REPORTS_DIR, type);
  if (!existsSync(dir)) {mkdirSync(dir, { recursive: true });}
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify({ id, ...report }, null, 2));
  return id;
}

function listReports(type) {
  const dir = join(AUDIT_REPORTS_DIR, type);
  if (!existsSync(dir)) {return [];}
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
        return {
          id: data.id,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          status: data.status,
          type: data.type,
          summary: data.summary || null,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .toSorted((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function spawnAudit(type, prompt) {
  const auditId = randomUUID();
  const startedAt = new Date().toISOString();
  let output = "";
  let errorOutput = "";

  const child = spawn(
    "claude",
    [
      "--print",
      prompt,
    ],
    {
      cwd: process.env.HOME || "/root",
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  runningAudits.set(auditId, {
    id: auditId,
    type,
    pid: child.pid,
    startedAt,
    status: "running",
    output: "",
  });

  child.stdout.on("data", (d) => {
    output += d.toString();
    const entry = runningAudits.get(auditId);
    if (entry) {entry.output = output;}
  });

  child.stderr.on("data", (d) => {
    errorOutput += d.toString();
  });

  child.on("close", (code) => {
    const entry = runningAudits.get(auditId);
    const status = code === 0 ? "completed" : "failed";
    const reportId = saveReport(type, {
      id: auditId,
      type,
      startedAt,
      completedAt: new Date().toISOString(),
      status,
      exitCode: code,
      output,
      error: errorOutput || null,
      summary: output.substring(0, 500),
      findings: parseFindings(output),
    });
    if (entry) {
      entry.status = status;
      entry.reportId = reportId;
    }
  });

  child.on("error", (err) => {
    const entry = runningAudits.get(auditId);
    if (entry) {
      entry.status = "failed";
      entry.error = err.message;
    }
  });

  return auditId;
}

// Parse structured findings from claude output (looks for numbered lists and headers)
function parseFindings(output) {
  const findings = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/) || line.match(/^[-*]\s+(.+)/);
    if (match) {findings.push(match[1].trim());}
  }
  return findings.slice(0, 20);
}

// ========== QA Audit ==========

router.post("/qa/trigger", (_req, res) => {
  const prompt = `Perform a QA audit of the OASIS dashboard system. Check:
1. All API endpoints are responding correctly
2. Configuration files are valid JSON
3. Docker containers are running and healthy
4. Gateway WebSocket connection is stable
5. Voice pipeline has no stuck jobs
6. Cron jobs are running on schedule
Report any issues found with severity levels (HIGH/MEDIUM/LOW).`;

  const auditId = spawnAudit("qa", prompt);
  res.json({ ok: true, auditId, status: "running" });
});

router.get("/qa/status", (_req, res) => {
  const audits = [];
  for (const [, audit] of runningAudits) {
    if (audit.type === "qa") {
      audits.push({
        id: audit.id,
        status: audit.status,
        startedAt: audit.startedAt,
        outputLength: audit.output.length,
      });
    }
  }
  res.json({ audits });
});

router.get("/qa/reports", (_req, res) => {
  res.json({ reports: listReports("qa") });
});

router.get("/qa/reports/:id", (req, res) => {
  const dir = join(AUDIT_REPORTS_DIR, "qa");
  if (!existsSync(dir)) {return res.status(404).json({ error: "No QA reports found" });}

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (data.id === req.params.id) {return res.json(data);}
    } catch {}
  }
  res.status(404).json({ error: "Report not found" });
});

router.put("/qa/reports/:id/approve", (req, res) => {
  const dir = join(AUDIT_REPORTS_DIR, "qa");
  if (!existsSync(dir)) {return res.status(404).json({ error: "Report not found" });}

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const path = join(dir, file);
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      if (data.id === req.params.id) {
        data.approved = true;
        data.approvedAt = new Date().toISOString();
        data.approvedFindings = req.body.findings || data.findings;
        writeFileSync(path, JSON.stringify(data, null, 2));
        return res.json({ ok: true, report: data });
      }
    } catch {}
  }
  res.status(404).json({ error: "Report not found" });
});

router.post("/qa/fix", (req, res) => {
  const { reportId, findings } = req.body;
  if (!reportId || !Array.isArray(findings) || findings.length === 0) {
    return res.status(400).json({ error: "reportId and findings array are required" });
  }

  const prompt = `Fix the following QA issues found in the OASIS system:\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nApply fixes carefully and report what was changed.`;
  const fixId = spawnAudit("qa-fix", prompt);
  res.json({ ok: true, fixId, status: "running" });
});

// ========== Security Audit ==========

router.post("/security/trigger", (_req, res) => {
  const prompt = `Perform a security audit of the OASIS dashboard system. Check:
1. Authentication is properly enforced on all endpoints
2. No sensitive credentials are exposed in responses
3. Input validation is present on all user-supplied parameters
4. File path traversal vulnerabilities (verify path containment checks)
5. Rate limiting is functioning
6. Security headers are set correctly
7. WebSocket authentication is enforced
Report any vulnerabilities with CVSS severity ratings.`;

  const auditId = spawnAudit("security", prompt);
  res.json({ ok: true, auditId, status: "running" });
});

router.get("/security/status", (_req, res) => {
  const audits = [];
  for (const [, audit] of runningAudits) {
    if (audit.type === "security") {
      audits.push({
        id: audit.id,
        status: audit.status,
        startedAt: audit.startedAt,
        outputLength: audit.output.length,
      });
    }
  }
  res.json({ audits });
});

router.get("/security/reports", (_req, res) => {
  res.json({ reports: listReports("security") });
});

router.get("/security/reports/:id", (req, res) => {
  const dir = join(AUDIT_REPORTS_DIR, "security");
  if (!existsSync(dir)) {return res.status(404).json({ error: "No security reports found" });}

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (data.id === req.params.id) {return res.json(data);}
    } catch {}
  }
  res.status(404).json({ error: "Report not found" });
});

// ========== Security Audit — approve & fix (mirrors QA routes) ==========

router.put("/security/reports/:id/approve", (req, res) => {
  const dir = join(AUDIT_REPORTS_DIR, "security");
  if (!existsSync(dir)) {return res.status(404).json({ error: "Report not found" });}

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const path = join(dir, file);
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      if (data.id === req.params.id) {
        data.approved = true;
        data.approvedAt = new Date().toISOString();
        data.approvedFindings = req.body.findingIds || req.body.findings || data.findings;
        writeFileSync(path, JSON.stringify(data, null, 2));
        return res.json({ ok: true, report: data });
      }
    } catch {}
  }
  res.status(404).json({ error: "Report not found" });
});

router.post("/security/fix", (req, res) => {
  const { reportId, findings } = req.body;
  if (!reportId || !Array.isArray(findings) || findings.length === 0) {
    return res.status(400).json({ error: "reportId and findings array are required" });
  }

  const prompt = `Fix the following security issues found in the OASIS system:\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nApply fixes carefully, maintaining security best practices. Report what was changed.`;
  const fixId = spawnAudit("security-fix", prompt);
  res.json({ ok: true, fixId, status: "running" });
});

export default router;
