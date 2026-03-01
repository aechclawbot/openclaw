/**
 * OASIS Dashboard v3 - Dito Routes
 * Leads CRUD + demos list.
 */

import { Router } from "express";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { readPipelineMd, writePipelineMd } from "../utils/markdown-parser.js";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const DITO_PIPELINE = join(CONFIG_DIR, "workspace-dito", "leads", "pipeline.md");

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

// GET /pipeline — leads grouped by status as a sales pipeline view
router.get("/pipeline", (_req, res) => {
  try {
    const leads = readPipelineMd(DITO_PIPELINE);

    // Group leads by status
    const stages = {};
    for (const lead of leads) {
      const status = lead.status || "identified";
      if (!stages[status]) {stages[status] = [];}
      stages[status].push(lead);
    }

    // Standard pipeline stage order
    const stageOrder = ["identified", "qualified", "contacted", "proposal", "negotiation", "closed", "lost"];
    const orderedStages = {};
    for (const stage of stageOrder) {
      if (stages[stage]) {orderedStages[stage] = stages[stage];}
    }
    // Include any non-standard stages
    for (const [stage, items] of Object.entries(stages)) {
      if (!orderedStages[stage]) {orderedStages[stage] = items;}
    }

    res.json({
      pipeline: orderedStages,
      totalLeads: leads.length,
      stageCount: Object.fromEntries(Object.entries(orderedStages).map(([k, v]) => [k, v.length])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /leads — list all leads
router.get("/leads", (req, res) => {
  try {
    res.json({ leads: readPipelineMd(DITO_PIPELINE) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /leads — add a lead
router.post("/leads", (req, res) => {
  try {
    const leads = readPipelineMd(DITO_PIPELINE);
    const { name, type, location, status, contact, notes, website } = req.body;
    if (!name) {return res.status(400).json({ error: "name is required" });}
    const lead = {
      index: leads.length,
      name,
      type: type || "",
      location: location || "",
      status: status || "identified",
      contact: contact || "",
      notes: notes || "",
      website: website || "",
      dateAdded: new Date().toISOString().split("T")[0],
    };
    leads.push(lead);
    writePipelineMd(DITO_PIPELINE, leads);
    logActivity("dito", "dito", `New lead added: ${name}`);
    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /leads/:index — update a lead by index
router.patch("/leads/:index", (req, res) => {
  try {
    if (!existsSync(DITO_PIPELINE)) {return res.status(404).json({ error: "Pipeline not found" });}
    const leads = readPipelineMd(DITO_PIPELINE);
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= leads.length) {return res.status(404).json({ error: "Lead not found" });}
    for (const key of ["name", "type", "location", "status", "contact", "notes", "website"]) {
      if (req.body[key] !== undefined) {leads[idx][key] = req.body[key];}
    }
    writePipelineMd(DITO_PIPELINE, leads);
    logActivity("dito", "dito", `Updated lead: ${leads[idx].name} → ${leads[idx].status}`);
    res.json({ ok: true, lead: leads[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /leads/:index — delete a lead by index
router.delete("/leads/:index", (req, res) => {
  try {
    if (!existsSync(DITO_PIPELINE)) {return res.status(404).json({ error: "Pipeline not found" });}
    const leads = readPipelineMd(DITO_PIPELINE);
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= leads.length) {return res.status(404).json({ error: "Lead not found" });}
    const removed = leads.splice(idx, 1)[0];
    writePipelineMd(DITO_PIPELINE, leads);
    logActivity("dito", "dito", `Removed lead: ${removed.name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /demos — list available demo sites
router.get("/demos", (req, res) => {
  try {
    const sitesDir = join(CONFIG_DIR, "workspace-dito/sites");
    const entries = existsSync(sitesDir)
      ? readdirSync(sitesDir, { withFileTypes: true })
      : [];
    const demos = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const indexExists = existsSync(join(sitesDir, entry.name, "index.html"));
        demos.push({
          name: entry.name,
          url: `/demos/${entry.name}/`,
          hasIndex: indexExists,
        });
      }
    }
    res.json({ demos });
  } catch (err) {
    res.json({ demos: [] });
  }
});

export default router;
