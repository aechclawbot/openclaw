/**
 * OASIS Dashboard v3 - Scan Extractor
 *
 * Parses cron scan summaries and extracts structured items
 * (projects, leads, deals) into the agent data files.
 * Deduplicates by title match to avoid inserting the same item twice.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";

// ─── File helpers ────────────────────────────────────────

function readJsonSafe(path) {
  try {
    if (!existsSync(path)) {return [];}
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

function writeJson(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) {mkdirSync(dir, { recursive: true });}
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ─── Nolan: extract bounties from clawlancer-scan ────────

const NOLAN_PROJECTS = join(CONFIG_DIR, "workspace-nolan", "projects.json");

/**
 * Primary pattern: "Title" (ID: uuid) - Status. (N USDC)
 */
const BOUNTY_QUOTED_RE =
  /"([^"]+)"\s*\(ID:\s*([0-9a-f-]{36})\)\s*[-–—]\s*([^.(]+)\.?\s*\((\d+(?:\.\d+)?)\s*USDC\)/gi;

/**
 * Bold pattern: **Title** (ID: uuid) - Status. (N USDC)
 */
const BOUNTY_BOLD_RE =
  /\*\*([^*]+)\*\*\s*\(ID:\s*([0-9a-f-]{36})\)\s*[-–—]\s*([^.(]+)\.?\s*\((\d+(?:\.\d+)?)\s*USDC\)/gi;

/** Fallback: just title + ID, no fee */
const BOUNTY_ALT_RE =
  /(?:"|(?:\*\*))([^"*]+)(?:"|(?:\*\*))\s*\(ID:\s*([0-9a-f-]{36})\)/gi;

function extractNolanProjects(summary) {
  if (!summary) {return [];}
  const items = [];
  const seen = new Set();

  // Quoted pattern: "title" (ID: ...) - status. (N USDC)
  for (const m of summary.matchAll(BOUNTY_QUOTED_RE)) {
    const [, title, id, statusText, fee] = m;
    if (seen.has(id)) {continue;}
    seen.add(id);
    const lowerStatus = statusText.trim().toLowerCase();
    let status = "identified";
    if (lowerStatus.includes("claim")) {status = "claimed";}
    else if (lowerStatus.includes("progress")) {status = "in-progress";}
    else if (lowerStatus.includes("submit")) {status = "submitted";}
    else if (lowerStatus.includes("complet")) {status = "completed";}
    else if (lowerStatus.includes("viable") || lowerStatus.includes("proposal")) {status = "identified";}
    items.push({
      externalId: id,
      source: "clawtasks",
      title: title.trim(),
      fee: parseFloat(fee) || 0,
      status,
    });
  }

  // Bold pattern: **title** (ID: ...) - status. (N USDC)
  for (const m of summary.matchAll(BOUNTY_BOLD_RE)) {
    const [, title, id, statusText, fee] = m;
    if (seen.has(id)) {continue;}
    seen.add(id);
    const lowerStatus = statusText.trim().toLowerCase();
    let status = "identified";
    if (lowerStatus.includes("claim")) {status = "claimed";}
    else if (lowerStatus.includes("progress")) {status = "in-progress";}
    else if (lowerStatus.includes("submit")) {status = "submitted";}
    else if (lowerStatus.includes("complet")) {status = "completed";}
    items.push({
      externalId: id,
      source: "clawtasks",
      title: title.trim(),
      fee: parseFloat(fee) || 0,
      status,
    });
  }

  // Fallback pattern: no fee
  for (const m of summary.matchAll(BOUNTY_ALT_RE)) {
    const [, title, id] = m;
    if (seen.has(id)) {continue;}
    seen.add(id);
    items.push({
      externalId: id,
      source: "clawtasks",
      title: title.trim(),
      fee: 0,
      status: "identified",
    });
  }

  return items;
}

function mergeNolanProjects(extracted) {
  const existing = readJsonSafe(NOLAN_PROJECTS);
  const existingTitles = new Set(existing.map((p) => p.title?.toLowerCase()));
  const existingExtIds = new Set(
    existing.map((p) => p.externalId).filter(Boolean)
  );
  let added = 0;

  for (const item of extracted) {
    // Skip duplicates by external ID or title
    if (item.externalId && existingExtIds.has(item.externalId)) {continue;}
    if (existingTitles.has(item.title.toLowerCase())) {continue;}

    existing.push({
      id: randomUUID(),
      externalId: item.externalId,
      source: item.source,
      title: item.title,
      description: "",
      fee: item.fee,
      status: item.status,
      url: item.externalId
        ? `https://clawtasks.com/bounties/${item.externalId}`
        : "",
      dateAdded: new Date().toISOString().split("T")[0],
      dateCompleted: null,
      notes: "Auto-extracted from scan",
    });
    added++;
  }

  if (added > 0) {
    writeJson(NOLAN_PROJECTS, existing);
  }
  return added;
}

// ─── Dito: extract leads from prospecting scan ───────────

import { readPipelineMd, writePipelineMd } from "../utils/markdown-parser.js";

const DITO_PIPELINE = join(CONFIG_DIR, "workspace-dito", "leads", "pipeline.md");

/**
 * Pattern: N. **Name** (Type): Notes.
 * Also: **Name Location** (Type):
 */
const LEAD_RE =
  /\d+\.\s+\*\*([^*]+)\*\*\s*\(([^)]+)\):\s*(.+?)(?:\n|$)/gi;

function extractDitoLeads(summary) {
  if (!summary) {return [];}
  const items = [];
  for (const m of summary.matchAll(LEAD_RE)) {
    const [, nameRaw, type, notes] = m;
    const name = nameRaw.trim();
    items.push({
      name,
      type: type.trim(),
      location: "", // often embedded in name
      status: "qualified",
      notes: notes.trim(),
    });
  }
  return items;
}

function mergeDitoLeads(extracted) {
  let existing = [];
  try {
    existing = readPipelineMd(DITO_PIPELINE);
  } catch {
    existing = [];
  }
  const existingNames = new Set(existing.map((l) => l.name?.toLowerCase()));
  let added = 0;

  for (const item of extracted) {
    if (existingNames.has(item.name.toLowerCase())) {continue;}
    existing.push({
      index: existing.length,
      name: item.name,
      type: item.type,
      location: item.location,
      status: item.status,
      contact: "",
      notes: item.notes,
      website: "",
      dateAdded: new Date().toISOString().split("T")[0],
    });
    added++;
  }

  if (added > 0) {
    try {
      writePipelineMd(DITO_PIPELINE, existing);
    } catch {
      // pipeline.md dir may not exist yet
    }
  }
  return added;
}

// ─── Aech: extract deals from arb scan ───────────────────

const AECH_DEALS = join(CONFIG_DIR, "workspace-aech", "deals.json");

/**
 * Pattern: **AssetName** ... $buyPrice ... $sellPrice ... spread%
 * Aech's summaries are usually "no opportunities found", so this is best-effort.
 */
const DEAL_RE =
  /\*\*([^*]+)\*\*[^$]*\$(\d+(?:\.\d+)?)[^$]*\$(\d+(?:\.\d+)?)[^%]*?([\d.]+)%/gi;

function extractAechDeals(summary) {
  if (!summary) {return [];}
  // Quick bail: most scans have no opportunities
  const lower = summary.toLowerCase();
  if (
    lower.includes("no arbitrage") ||
    lower.includes("no verifiable") ||
    lower.includes("scan clean") ||
    lower.includes("no viable")
  ) {
    return [];
  }
  const items = [];
  for (const m of summary.matchAll(DEAL_RE)) {
    const [, asset, buyStr, sellStr, spreadStr] = m;
    items.push({
      asset: asset.trim(),
      buyPrice: parseFloat(buyStr) || 0,
      sellPrice: parseFloat(sellStr) || 0,
      spread: spreadStr + "%",
    });
  }
  return items;
}

function mergeAechDeals(extracted) {
  const existing = readJsonSafe(AECH_DEALS);
  const existingAssets = new Set(existing.map((d) => d.asset?.toLowerCase()));
  let added = 0;

  for (const item of extracted) {
    if (existingAssets.has(item.asset.toLowerCase())) {continue;}
    existing.push({
      id: randomUUID(),
      asset: item.asset,
      source: "scan",
      listingUrl: "",
      buyPrice: item.buyPrice,
      sellPrice: item.sellPrice,
      spread: item.spread,
      fees: 0,
      riskLevel: 1,
      status: "identified",
      artemisStatus: "pending",
      profit: null,
      dateAdded: new Date().toISOString().split("T")[0],
      dateCompleted: null,
      notes: "Auto-extracted from scan",
    });
    added++;
  }

  if (added > 0) {
    writeJson(AECH_DEALS, existing);
  }
  return added;
}

// ─── Main dispatcher ─────────────────────────────────────

/**
 * Extract items from a completed cron run and merge into the agent data file.
 * Returns { agent, extracted, added } or null if not applicable.
 */
export function extractFromScanRun(jobId, runEntry) {
  if (!runEntry || runEntry.status !== "ok") {return null;}
  const summary = runEntry.summary || "";

  if (jobId === "clawlancer-scan") {
    const extracted = extractNolanProjects(summary);
    if (extracted.length === 0) {return { agent: "nolan", extracted: 0, added: 0 };}
    const added = mergeNolanProjects(extracted);
    return { agent: "nolan", extracted: extracted.length, added };
  }

  if (jobId === "dito-daily-prospecting" || jobId === "dito-weekly-pipeline") {
    const extracted = extractDitoLeads(summary);
    if (extracted.length === 0) {return { agent: "dito", extracted: 0, added: 0 };}
    const added = mergeDitoLeads(extracted);
    return { agent: "dito", extracted: extracted.length, added };
  }

  if (jobId === "aech-arb-scan") {
    const extracted = extractAechDeals(summary);
    if (extracted.length === 0) {return { agent: "aech", extracted: 0, added: 0 };}
    const added = mergeAechDeals(extracted);
    return { agent: "aech", extracted: extracted.length, added };
  }

  return null;
}
