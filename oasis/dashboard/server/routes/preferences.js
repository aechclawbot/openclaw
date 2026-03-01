/**
 * OASIS Dashboard v3 - Preferences Routes (NEW)
 * GET /  — list preference categories
 * GET /:category — read preference file
 * PUT /:category — write preference file
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";

// Supported preference categories and their backing files
const PREFERENCE_CATEGORIES = {
  food: "workspace-anorak/preferences/food.md",
  leisure: "workspace-anorak/preferences/leisure.md",
  "date-night": "workspace-anorak/preferences/date-night.md",
};

// GET / — list available preference categories
router.get("/", (_req, res) => {
  const categories = Object.entries(PREFERENCE_CATEGORIES).map(([category, relPath]) => {
    const fullPath = join(CONFIG_DIR, relPath);
    return {
      category,
      exists: existsSync(fullPath),
      path: relPath,
    };
  });
  res.json({ categories });
});

// GET /:category — read preference file
router.get("/:category", (req, res) => {
  const { category } = req.params;
  const relPath = PREFERENCE_CATEGORIES[category];
  if (!relPath) {
    return res.status(404).json({ error: `Unknown category: ${category}. Valid: ${Object.keys(PREFERENCE_CATEGORIES).join(", ")}` });
  }

  const baseDir = resolve(join(CONFIG_DIR, "workspace-anorak", "preferences"));
  const fullPath = resolve(join(CONFIG_DIR, relPath));

  // Path containment check
  if (!fullPath.startsWith(baseDir + "/") && !fullPath.startsWith(baseDir)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    if (!existsSync(fullPath)) {
      return res.json({ category, content: "", exists: false });
    }
    const content = readFileSync(fullPath, "utf-8");
    res.json({ category, content, exists: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:category — write preference file
router.put("/:category", (req, res) => {
  const { category } = req.params;
  const { content } = req.body;

  const relPath = PREFERENCE_CATEGORIES[category];
  if (!relPath) {
    return res.status(404).json({ error: `Unknown category: ${category}` });
  }
  if (content === undefined) {
    return res.status(400).json({ error: "content is required" });
  }

  const baseDir = resolve(join(CONFIG_DIR, "workspace-anorak", "preferences"));
  const fullPath = resolve(join(CONFIG_DIR, relPath));

  if (!fullPath.startsWith(baseDir + "/") && !fullPath.startsWith(baseDir)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    // Ensure directory exists
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content, "utf-8");
    res.json({ ok: true, category });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
