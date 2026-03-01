/**
 * OASIS Dashboard v3 - Nolan Routes
 * Projects CRUD.
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const NOLAN_PROJECTS = join(CONFIG_DIR, "workspace-nolan", "projects.json");

function readNolanProjects() {
  try {
    if (!existsSync(NOLAN_PROJECTS)) {return [];}
    return JSON.parse(readFileSync(NOLAN_PROJECTS, "utf-8"));
  } catch {
    return [];
  }
}

function writeNolanProjects(projects) {
  writeFileSync(NOLAN_PROJECTS, JSON.stringify(projects, null, 2));
}

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

// GET /projects
router.get("/projects", (req, res) => {
  res.json({ projects: readNolanProjects() });
});

// POST /projects
router.post("/projects", (req, res) => {
  try {
    const projects = readNolanProjects();
    const { source, title, description, fee, url, notes } = req.body;
    if (!title) {return res.status(400).json({ error: "title is required" });}
    const project = {
      id: randomUUID(),
      source: source || "Manual",
      title,
      description: description || "",
      fee: fee || "",
      status: "identified",
      url: url || "",
      dateAdded: new Date().toISOString().split("T")[0],
      dateCompleted: null,
      notes: notes || "",
    };
    projects.push(project);
    writeNolanProjects(projects);
    logActivity("nolan", "nolan", `New project added: ${title}`);
    res.json({ ok: true, project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /projects/:id
router.patch("/projects/:id", (req, res) => {
  try {
    const projects = readNolanProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {return res.status(404).json({ error: "Project not found" });}
    for (const key of ["source", "title", "description", "fee", "status", "url", "notes", "dateCompleted"]) {
      if (req.body[key] !== undefined) {projects[idx][key] = req.body[key];}
    }
    if (req.body.status === "completed" && !projects[idx].dateCompleted) {
      projects[idx].dateCompleted = new Date().toISOString().split("T")[0];
    }
    writeNolanProjects(projects);
    logActivity("nolan", "nolan", `Updated project: ${projects[idx].title} → ${projects[idx].status}`);
    res.json({ ok: true, project: projects[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /projects/:id
router.delete("/projects/:id", (req, res) => {
  try {
    const projects = readNolanProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {return res.status(404).json({ error: "Project not found" });}
    const removed = projects.splice(idx, 1)[0];
    writeNolanProjects(projects);
    logActivity("nolan", "nolan", `Removed project: ${removed.title}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
