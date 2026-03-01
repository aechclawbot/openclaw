/**
 * OASIS Dashboard v3 - Aech Routes
 * Deals CRUD.
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const AECH_DEALS = join(CONFIG_DIR, "workspace-aech", "deals.json");

function readAechDeals() {
  try {
    if (!existsSync(AECH_DEALS)) {return [];}
    return JSON.parse(readFileSync(AECH_DEALS, "utf-8"));
  } catch {
    return [];
  }
}

function writeAechDeals(deals) {
  writeFileSync(AECH_DEALS, JSON.stringify(deals, null, 2));
}

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

// GET /deals
router.get("/deals", (req, res) => {
  res.json({ deals: readAechDeals() });
});

// POST /deals
router.post("/deals", (req, res) => {
  try {
    const deals = readAechDeals();
    const { asset, assetName, source, listingUrl, buyPrice, sellPrice, fees, estimatedFees, riskLevel, notes } = req.body;
    const resolvedAsset = asset || assetName;
    if (!resolvedAsset) {return res.status(400).json({ error: "asset is required" });}
    const resolvedFees = fees ?? estimatedFees;
    const buy = parseFloat(buyPrice) || 0;
    const sell = parseFloat(sellPrice) || 0;
    const spread = buy > 0 ? (((sell - buy) / buy) * 100).toFixed(1) + "%" : "--";
    const deal = {
      id: randomUUID(),
      asset: resolvedAsset,
      source: source || "",
      listingUrl: listingUrl || "",
      buyPrice: buy,
      sellPrice: sell,
      spread,
      fees: parseFloat(resolvedFees) || 0,
      riskLevel: parseInt(riskLevel) || 1,
      status: "identified",
      artemisStatus: "pending",
      profit: null,
      dateAdded: new Date().toISOString().split("T")[0],
      dateCompleted: null,
      notes: notes || "",
    };
    deals.push(deal);
    writeAechDeals(deals);
    logActivity("aech", "aech", `New deal: ${asset} (${spread} spread)`);
    res.json({ ok: true, deal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /deals/:id
router.patch("/deals/:id", (req, res) => {
  try {
    const deals = readAechDeals();
    const idx = deals.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {return res.status(404).json({ error: "Deal not found" });}
    // Accept frontend field names (assetName, estimatedFees) as aliases
    if (req.body.assetName !== undefined && req.body.asset === undefined) {req.body.asset = req.body.assetName;}
    if (req.body.estimatedFees !== undefined && req.body.fees === undefined) {req.body.fees = req.body.estimatedFees;}
    for (const key of ["asset", "source", "listingUrl", "buyPrice", "sellPrice", "fees", "riskLevel", "status", "artemisStatus", "profit", "notes", "dateCompleted"]) {
      if (req.body[key] !== undefined) {deals[idx][key] = req.body[key];}
    }
    // Recalculate spread if prices changed
    if (req.body.buyPrice !== undefined || req.body.sellPrice !== undefined) {
      const buy = deals[idx].buyPrice;
      const sell = deals[idx].sellPrice;
      deals[idx].spread = buy > 0 ? (((sell - buy) / buy) * 100).toFixed(1) + "%" : "--";
    }
    if (req.body.status === "completed" && !deals[idx].dateCompleted) {
      deals[idx].dateCompleted = new Date().toISOString().split("T")[0];
    }
    writeAechDeals(deals);
    logActivity("aech", "aech", `Updated deal: ${deals[idx].asset} → ${deals[idx].status}`);
    res.json({ ok: true, deal: deals[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /deals/:id
router.delete("/deals/:id", (req, res) => {
  try {
    const deals = readAechDeals();
    const idx = deals.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {return res.status(404).json({ error: "Deal not found" });}
    const removed = deals.splice(idx, 1)[0];
    writeAechDeals(deals);
    logActivity("aech", "aech", `Removed deal: ${removed.asset}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
