/**
 * OASIS Dashboard v3 - Recipes Routes
 * Meal plan week/day management, shopping list, feedback, refresh.
 */

import { Router } from "express";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { rpcCall } from "../services/gateway-client.js";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const MEAL_PLANS_DIR = join(CONFIG_DIR, "workspace-anorak", "meal-plans");
const FEEDBACK_FILE = join(CONFIG_DIR, "workspace-anorak", "feedback", "recipe-feedback.json");

const VALID_WEEK = /^\d{4}-W\d{2}$/;
const VALID_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function getISOWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function readFeedback() {
  try {
    if (!existsSync(FEEDBACK_FILE)) {return [];}
    return JSON.parse(readFileSync(FEEDBACK_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeFeedback(entries) {
  writeFileSync(FEEDBACK_FILE, JSON.stringify(entries, null, 2));
}

function parseIngredientsFromRecipe(filePath) {
  if (!existsSync(filePath)) {return [];}
  const content = readFileSync(filePath, "utf-8");
  const ingredientMatch = content.match(/## Ingredients:?\s*\n([\s\S]*?)(?=\n## )/);
  if (!ingredientMatch) {return [];}
  const items = [];
  for (const line of ingredientMatch[1].split("\n")) {
    const m = line.match(/^\*\s+(.+)/);
    if (m) {items.push(m[1].trim());}
  }
  return items;
}

function categorizeIngredient(name) {
  const lower = name.toLowerCase();
  const produceWords = ["lettuce", "tomato", "onion", "garlic", "pepper", "cucumber", "lemon", "lime", "avocado", "cilantro", "ginger", "basil", "asparagus", "broccoli", "carrot", "apple", "banana", "berry", "grape", "orange", "strawberry", "watermelon", "fruit", "parsley", "thyme", "herb"];
  const meatWords = ["chicken", "beef", "pork", "salmon", "fish", "sausage", "bacon", "turkey", "shrimp", "meat", "steak", "fillet", "ground"];
  const dairyWords = ["milk", "egg", "cheese", "butter", "yogurt", "cream", "sour cream", "parmesan"];
  const frozenWords = ["frozen"];
  const pantryWords = ["oil", "salt", "pepper", "flour", "sugar", "rice", "pasta", "bread", "sauce", "broth", "stock", "soy", "vinegar", "honey", "spice", "seasoning", "cumin", "paprika", "oregano", "cornstarch", "can ", "canned", "tortilla", "wrap"];
  if (frozenWords.some((w) => lower.includes(w))) {return "Frozen";}
  if (meatWords.some((w) => lower.includes(w))) {return "Meat/Seafood";}
  if (dairyWords.some((w) => lower.includes(w))) {return "Dairy";}
  if (produceWords.some((w) => lower.includes(w))) {return "Produce";}
  if (pantryWords.some((w) => lower.includes(w))) {return "Pantry";}
  return "Other";
}

function mergeIngredients(allItems) {
  const merged = new Map();
  for (const item of allItems) {
    const key = item.toLowerCase().replace(/[\d¼½¾⅓⅔⅛]+/g, "").replace(/\([^)]*\)/g, "").replace(/,.*$/, "").replace(/\s+/g, " ").trim();
    if (!merged.has(key)) {merged.set(key, []);}
    merged.get(key).push(item);
  }
  const results = [];
  for (const [, variants] of merged) {
    results.push(variants.toSorted((a, b) => b.length - a.length)[0]);
  }
  return results;
}

function parseShoppingListFromPlan(weekFile) {
  if (!existsSync(weekFile)) {return null;}
  const content = readFileSync(weekFile, "utf-8");
  const shoppingMatch = content.match(/## Shopping List\s*\n([\s\S]*?)(?=\n## |\n---|Z)/);
  if (!shoppingMatch) {return null;}

  const sections = {};
  let currentSection = "Other";
  const sectionMap = {
    "produce": "Produce", "meat/seafood": "Meat/Seafood", "meat": "Meat/Seafood",
    "seafood": "Meat/Seafood", "dairy": "Dairy", "pantry": "Pantry",
    "frozen": "Frozen", "other": "Other",
  };

  for (const line of shoppingMatch[1].split("\n")) {
    const sectionHeader = line.match(/^\*\*([^*]+)\*\*:?\s*$/);
    if (sectionHeader) {
      const raw = sectionHeader[1].toLowerCase().replace(/:$/, "").trim();
      currentSection = sectionMap[raw] || sectionHeader[1].replace(/:$/, "").trim();
      if (!sections[currentSection]) {sections[currentSection] = [];}
      continue;
    }
    const itemMatch = line.match(/^\*\s+(.+)/);
    if (itemMatch) {
      const raw = itemMatch[1].trim();
      if (!sections[currentSection]) {sections[currentSection] = [];}
      const nameForSearch = raw
        .replace(/\([^)]*\)/g, "").replace(/,.*$/, "")
        .replace(/[\d¼½¾⅓⅔⅛/]+/g, "")
        .replace(/\b(?:cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|pound|pounds|lb|lbs|oz|ounce|ounces|bunch|pint|head|bag|box|can|jar|pack|dozen|gallon|carton|container|small|large|medium|cloves?|to taste)\b/gi, "")
        .replace(/\s+/g, " ").trim();
      sections[currentSection].push({
        name: raw,
        searchName: nameForSearch || raw.split("(")[0].trim(),
        targetUrl: `https://www.target.com/s?searchTerm=${encodeURIComponent(nameForSearch || raw.split("(")[0].trim())}`,
      });
    }
  }
  return sections;
}

// GET / — recipe index: current week info + available weeks
router.get("/", (_req, res) => {
  try {
    const week = getISOWeek();
    let currentWeek = week;
    let planExists = existsSync(join(MEAL_PLANS_DIR, `${week}.md`));
    let dirExists = existsSync(join(MEAL_PLANS_DIR, `${week}-recipes`));

    if (!planExists && !dirExists && existsSync(MEAL_PLANS_DIR)) {
      const dirs = readdirSync(MEAL_PLANS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
        .map((e) => e.name.replace("-recipes", ""))
        .toSorted().toReversed();
      if (dirs.length > 0) {
        currentWeek = dirs[0];
        planExists = existsSync(join(MEAL_PLANS_DIR, `${currentWeek}.md`));
        dirExists = existsSync(join(MEAL_PLANS_DIR, `${currentWeek}-recipes`));
      }
    }

    let recipeCount = 0;
    if (dirExists) {
      recipeCount = readdirSync(join(MEAL_PLANS_DIR, `${currentWeek}-recipes`)).filter((f) => f.endsWith(".md")).length;
    }

    const weeks = existsSync(MEAL_PLANS_DIR)
      ? readdirSync(MEAL_PLANS_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
          .map((e) => e.name.replace("-recipes", ""))
          .toSorted().toReversed()
      : [];

    res.json({
      currentWeek,
      exists: planExists || dirExists,
      recipeCount,
      weeks,
      totalWeeks: weeks.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /current — current week's meal plan (defaults to current ISO week)
router.get("/current", (req, res) => {
  try {
    let week = req.query.week;
    if (!week || !VALID_WEEK.test(week)) {
      week = getISOWeek();
    }

    // If no plan for current week, fall back to most recent
    let dirExists = existsSync(join(MEAL_PLANS_DIR, `${week}-recipes`));
    if (!dirExists && existsSync(MEAL_PLANS_DIR)) {
      const dirs = readdirSync(MEAL_PLANS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
        .map((e) => e.name.replace("-recipes", ""))
        .toSorted().toReversed();
      if (dirs.length > 0) {
        week = dirs[0];
        dirExists = true;
      }
    }

    const dir = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`));
    if (!dir.startsWith(resolve(MEAL_PLANS_DIR))) {return res.status(403).json({ error: "Access denied" });}
    if (!dirExists) {return res.json({ week, days: [] });}

    const days = VALID_DAYS.map((day) => {
      const file = join(dir, `${day}.md`);
      if (!existsSync(file)) {return { day, exists: false };}
      const content = readFileSync(file, "utf-8");
      const titleMatch = content.match(/^#\s+(.+)/m);
      const timeMatch = content.match(/\*\*(?:Total|Cook)\s*(?:Time|time)[:\s]*\*\*\s*(.+)/i) ||
        content.match(/(?:Total|Cook)\s*(?:Time|time)[:\s]+(\d+\s*min(?:utes)?)/i);
      return { day, exists: true, title: titleMatch ? titleMatch[1].trim() : day, cookTime: timeMatch ? timeMatch[1].trim() : null };
    });

    res.json({ week, days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /current-week
router.get("/current-week", (_req, res) => {
  try {
    const week = getISOWeek();
    let target = week;
    let planExists = existsSync(join(MEAL_PLANS_DIR, `${week}.md`));
    let dirExists = existsSync(join(MEAL_PLANS_DIR, `${week}-recipes`));

    if (!planExists && !dirExists && existsSync(MEAL_PLANS_DIR)) {
      const dirs = readdirSync(MEAL_PLANS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
        .map((e) => e.name.replace("-recipes", ""))
        .toSorted().toReversed();
      if (dirs.length > 0) {
        target = dirs[0];
        planExists = existsSync(join(MEAL_PLANS_DIR, `${target}.md`));
        dirExists = existsSync(join(MEAL_PLANS_DIR, `${target}-recipes`));
      }
    }

    let recipeCount = 0;
    if (dirExists) {
      recipeCount = readdirSync(join(MEAL_PLANS_DIR, `${target}-recipes`)).filter((f) => f.endsWith(".md")).length;
    }
    res.json({ week: target, exists: planExists || dirExists, recipeCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /weeks
router.get("/weeks", (_req, res) => {
  try {
    if (!existsSync(MEAL_PLANS_DIR)) {return res.json({ weeks: [] });}
    const entries = readdirSync(MEAL_PLANS_DIR, { withFileTypes: true });
    const weeks = entries
      .filter((e) => e.isDirectory() && /^\d{4}-W\d{2}-recipes$/.test(e.name))
      .map((e) => e.name.replace("-recipes", ""))
      .toSorted().toReversed();
    res.json({ weeks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /feedback — feedback history
router.get("/feedback", (req, res) => {
  const entries = readFeedback();
  const week = req.query.week;
  const filtered = week ? entries.filter((e) => e.week === week) : entries;
  res.json({ feedback: filtered });
});

// GET /:week — days list for a week
router.get("/:week", (req, res) => {
  const { week } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  try {
    const dir = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`));
    if (!dir.startsWith(resolve(MEAL_PLANS_DIR))) {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(dir)) {return res.json({ week, days: [] });}
    const days = VALID_DAYS.map((day) => {
      const file = join(dir, `${day}.md`);
      if (!existsSync(file)) {return { day, exists: false };}
      const content = readFileSync(file, "utf-8");
      const titleMatch = content.match(/^#\s+(.+)/m);
      const timeMatch = content.match(/\*\*(?:Total|Cook)\s*(?:Time|time)[:\s]*\*\*\s*(.+)/i) ||
        content.match(/(?:Total|Cook)\s*(?:Time|time)[:\s]+(\d+\s*min(?:utes)?)/i);
      return { day, exists: true, title: titleMatch ? titleMatch[1].trim() : day, cookTime: timeMatch ? timeMatch[1].trim() : null };
    });
    res.json({ week, days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:week/shopping-list — shopping list from plan markdown
router.get("/:week/shopping-list", (req, res) => {
  const { week } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  try {
    const weekFile = resolve(join(MEAL_PLANS_DIR, `${week}.md`));
    if (!weekFile.startsWith(resolve(MEAL_PLANS_DIR))) {return res.status(403).json({ error: "Access denied" });}
    const sections = parseShoppingListFromPlan(weekFile);
    if (!sections) {return res.status(404).json({ error: "No shopping list found for this week" });}
    res.json({ week, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:week/shopping-list — filtered by selected days
router.post("/:week/shopping-list", (req, res) => {
  const { week } = req.params;
  const { days } = req.body;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  if (!Array.isArray(days) || days.length === 0) {return res.status(400).json({ error: "days array is required" });}
  const invalidDays = days.filter((d) => !VALID_DAYS.includes(d));
  if (invalidDays.length) {return res.status(400).json({ error: `Invalid days: ${invalidDays.join(", ")}` });}

  try {
    const recipeDir = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`));
    if (!recipeDir.startsWith(resolve(MEAL_PLANS_DIR))) {return res.status(403).json({ error: "Access denied" });}

    const allIngredients = [];
    const dayIngredients = {};
    for (const day of days) {
      const items = parseIngredientsFromRecipe(join(recipeDir, `${day}.md`));
      dayIngredients[day] = items;
      allIngredients.push(...items);
    }

    const merged = mergeIngredients(allIngredients);
    const sections = {};
    const sectionOrder = ["Produce", "Meat/Seafood", "Dairy", "Pantry", "Frozen", "Other"];
    for (const name of merged) {
      const section = categorizeIngredient(name);
      if (!sections[section]) {sections[section] = [];}
      const searchName = name
        .replace(/\([^)]*\)/g, "")
        .replace(/,.*$/, "")
        .replace(/[\d¼½¾⅓⅔⅛/]+/g, "")
        .replace(/\b(?:cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|pound|pounds|lb|lbs|oz|ounce|ounces|bunch|pint|head|bag|box|can|jar|pack|dozen|gallon|carton|container|small|large|medium|cloves?|to taste)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      sections[section].push({
        name,
        searchName: searchName || name,
        targetUrl: `https://www.target.com/s?searchTerm=${encodeURIComponent(searchName || name)}`,
      });
    }

    const ordered = {};
    for (const s of sectionOrder) {
      if (sections[s]) {ordered[s] = sections[s];}
    }

    res.json({ week, days, sections: ordered, dayIngredients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:week/:day/feedback
router.post("/:week/:day/feedback", (req, res) => {
  const { week, day } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  if (!VALID_DAYS.includes(day)) {return res.status(400).json({ error: "Invalid day" });}
  const { action, reason } = req.body;
  if (!["heart", "reject"].includes(action)) {return res.status(400).json({ error: "action must be heart or reject" });}

  const entries = readFeedback();
  const entry = { id: randomUUID(), week, day, action, reason: (reason || "").trim() || null, timestamp: new Date().toISOString() };
  entries.push(entry);
  writeFeedback(entries);

  // Fire-and-forget RPC to Anorak to update preferences
  const agentMsg = action === "heart"
    ? `Fred hearted the ${day} recipe for week ${week}. Reason: ${(reason || "no reason given").trim()}. Please update preferences/food.md under 'Hearted Recipes' with this feedback and note any patterns under 'Learned Preferences' for future meal plans.`
    : `Fred rejected the ${day} recipe for week ${week}. Reason: ${(reason || "no reason given").trim()}. Please update preferences/food.md under 'Rejected / Refreshed Recipes' with this feedback and note ingredients/cuisines/methods to avoid under 'Learned Preferences'.`;
  rpcCall("agent", { agentId: "anorak", message: agentMsg, idempotencyKey: randomUUID(), deliver: false }, 120_000)
    .catch(() => {});

  res.json({ ok: true, entry });
});

// POST /:week/:day/refresh — request recipe replacement
router.post("/:week/:day/refresh", async (req, res) => {
  const { week, day } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  if (!VALID_DAYS.includes(day)) {return res.status(400).json({ error: "Invalid day" });}
  const { reason } = req.body;
  if (!reason || !reason.trim()) {return res.status(400).json({ error: "reason is required" });}

  const entries = readFeedback();
  const entry = { id: randomUUID(), week, day, action: "refresh", reason: reason.trim(), timestamp: new Date().toISOString() };
  entries.push(entry);
  writeFeedback(entries);

  const message = `The recipe for ${day} of week ${week} was rejected. Reason: ${reason.trim()}. Please generate a replacement recipe that avoids this issue, save it to meal-plans/${week}-recipes/${day}.md, and update the shopping list in ${week}.md accordingly. Also update preferences/food.md under 'Rejected / Refreshed Recipes' to record this rejection so future weeks avoid similar issues.`;
  rpcCall("agent", { agentId: "anorak", message, idempotencyKey: randomUUID(), deliver: false }, 120_000)
    .catch(() => {});

  res.json({ ok: true, entry, status: "refresh_requested" });
});

// GET /:week/:day — single day recipe (must be after /shopping-list and /feedback)
router.get("/:week/:day", (req, res) => {
  const { week, day } = req.params;
  if (!VALID_WEEK.test(week)) {return res.status(400).json({ error: "Invalid week format" });}
  if (!VALID_DAYS.includes(day)) {return res.status(400).json({ error: "Invalid day" });}
  try {
    const file = resolve(join(MEAL_PLANS_DIR, `${week}-recipes`, `${day}.md`));
    if (!file.startsWith(resolve(MEAL_PLANS_DIR))) {return res.status(403).json({ error: "Access denied" });}
    if (!existsSync(file)) {return res.status(404).json({ error: "Recipe not found" });}
    const content = readFileSync(file, "utf-8");
    res.json({ week, day, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
