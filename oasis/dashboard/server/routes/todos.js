/**
 * OASIS Dashboard v3 - Todos Routes
 * CRUD with mutex-protected file I/O + planning/approval/scheduling workflow.
 */

import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { withMutex } from "../utils/file-mutex.js";

const router = Router();
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || "/config";
const TODOS_FILE = join(CONFIG_DIR, "dashboard-todos.json");
const COUNTER_FILE = join(CONFIG_DIR, "todo-counter.json");

const VALID_TODO_STATUSES = new Set([
  "pending", "planning", "awaiting_approval", "approved",
  "scheduled", "executing", "completed", "failed",
]);
const VALID_PRIORITIES = ["low", "medium", "high"];

/**
 * Run /oasis-ops skill after a todo execution completes.
 * Fire-and-forget: errors are logged but don't block the caller.
 */
function runOasisOps(context) {
  const label = context || "post-todo-execution";
  console.log(`[oasis-ops] Triggering /oasis-ops after ${label}`);
  const child = spawn("claude", ["-p", "/oasis-ops"], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  child.on("close", (code) => {
    console.log(`[oasis-ops] Completed after ${label} (exit ${code})`);
  });
  child.on("error", (err) => {
    console.error(`[oasis-ops] Failed after ${label}: ${err.message}`);
  });
}

function nextTaskNumberSync() {
  let counter = { next: 1 };
  try { counter = JSON.parse(readFileSync(COUNTER_FILE, "utf-8")); } catch {}
  const num = counter.next;
  counter.next = num + 1;
  writeFileSync(COUNTER_FILE, JSON.stringify(counter));
  return num;
}

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function logActivity(type, agent, message) {
  if (global.dashboardWs) {
    global.dashboardWs.broadcast({
      type: "activity",
      data: { id: randomUUID(), ts: Date.now(), type, agent, message },
    });
  }
}

async function readTodos() {
  try {
    if (!existsSync(TODOS_FILE)) return [];
    const raw = JSON.parse(await readFile(TODOS_FILE, "utf-8"));
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.todos) ? raw.todos : [];
    return arr.map((t) => ({
      id: t.id || randomUUID(),
      task_number: t.task_number || null,
      title: t.title || t.text || "Untitled",
      description: t.description || null,
      status: t.status || "pending",
      priority: t.priority || "medium",
      context: t.context || null,
      created_at: t.created_at || (t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString()),
      completed_at: t.completed_at || null,
      plan_details: t.plan_details || null,
      run_log: t.run_log || null,
      failure_reason: t.failure_reason || null,
      completion_summary: t.completion_summary || null,
      // New planning/scheduling fields
      execution_plan: t.execution_plan || null,
      execution_report: t.execution_report || null,
      approval_status: t.approval_status || null,
      scheduled_time: t.scheduled_time || null,
      run_post_op: t.run_post_op !== undefined ? t.run_post_op : true,
      plan_generated_at: t.plan_generated_at || null,
      plan_approved_at: t.plan_approved_at || null,
    }));
  } catch {
    return [];
  }
}

async function writeTodos(todos) {
  const tmpFile = TODOS_FILE + ".tmp";
  await writeFile(tmpFile, JSON.stringify(todos, null, 2));
  renameSync(tmpFile, TODOS_FILE);
}

// Active streams: { todoId -> { child, output } }
const todoProgressStreams = new Map();
const todoPlanStreams = new Map();

/**
 * Execute a task by spawning Claude with the task context + plan.
 * Shared by the /execute endpoint and the scheduling poller.
 */
function executeTask(todo) {
  const planSection = todo.execution_plan
    ? `\n\nApproved Execution Plan:\n${todo.execution_plan}\n\nFollow this plan exactly.`
    : "";
  const prompt = `Execute this OASIS task:\n\nTitle: ${todo.title}\n${todo.description ? `Description: ${todo.description}\n` : ""}${todo.context ? `Context: ${todo.context}\n` : ""}${planSection}\n\nComplete this task. Make all necessary file changes. Report what was done.`;

  let output = "";
  let errorOutput = "";

  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  todoProgressStreams.set(todo.id, { child, output: "" });

  child.stdout.on("data", (d) => {
    output += d.toString();
    const entry = todoProgressStreams.get(todo.id);
    if (entry) entry.output = output;
  });

  child.stderr.on("data", (d) => { errorOutput += d.toString(); });

  child.on("close", async (code) => {
    const timestamp = new Date().toISOString();
    try {
      await withMutex(TODOS_FILE, async () => {
        const all = await readTodos();
        const t = all.find((x) => x.id === todo.id);
        if (t) {
          t.status = code === 0 ? "completed" : "failed";
          t.run_log = output.substring(0, 50000);
          // Append to execution_report (preserves retry history)
          const runHeader = `\n\n=== Execution ${timestamp} (exit ${code}) ===\n`;
          t.execution_report = ((t.execution_report || "") + runHeader + output).substring(0, 100000);
          t.failure_reason = code !== 0 ? (errorOutput || `Exit code ${code}`).substring(0, 2000) : null;
          t.completion_summary = code === 0 ? output.substring(0, 2000) : null;
          if (code === 0) t.completed_at = new Date().toISOString();
          await writeTodos(all);
        }
      });
    } catch (e) {
      console.error(`[todo-execute] Failed to update todo: ${e.message}`);
    }
    todoProgressStreams.delete(todo.id);
    if (todo.run_post_op !== false) {
      runOasisOps(`todo-execute:${todo.title.substring(0, 40)}`);
    }
  });

  child.on("error", async (err) => {
    console.error(`[todo-execute] Spawn failed: ${err.message}`);
    try {
      await withMutex(TODOS_FILE, async () => {
        const all = await readTodos();
        const t = all.find((x) => x.id === todo.id);
        if (t) {
          t.status = "failed";
          t.failure_reason = err.message;
          await writeTodos(all);
        }
      });
    } catch {}
    todoProgressStreams.delete(todo.id);
  });
}

// ─── Scheduling Poller ───────────────────────────────────────────────────────
// Check every 60s for scheduled tasks that are due for execution.
setInterval(async () => {
  try {
    const todos = await readTodos();
    const now = Date.now();
    for (const todo of todos) {
      if (
        todo.scheduled_time &&
        todo.approval_status === "approved" &&
        (todo.status === "scheduled" || todo.status === "approved") &&
        new Date(todo.scheduled_time).getTime() <= now
      ) {
        console.log(`[scheduler] Executing scheduled task: ${todo.title}`);
        await withMutex(TODOS_FILE, async () => {
          const all = await readTodos();
          const t = all.find((x) => x.id === todo.id);
          if (t && (t.status === "scheduled" || t.status === "approved")) {
            t.status = "executing";
            t.scheduled_time = null;
            await writeTodos(all);
          }
        });
        logActivity("system", null, `Scheduled task executing: ${todo.title.substring(0, 60)}`);
        executeTask(todo);
        break; // One at a time to avoid resource contention
      }
    }
  } catch (e) {
    console.error(`[scheduler] Poll error: ${e.message}`);
  }
}, 60_000);

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET / — list todos
router.get("/", async (_req, res) => {
  res.json({ todos: await readTodos() });
});

// GET /:id/details — extended fields including pending plan match
router.get("/:id/details", async (req, res) => {
  const todos = await readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: "Not found" });

  const details = {
    id: todo.id,
    description: todo.description || null,
    plan_details: todo.plan_details || null,
    run_log: todo.run_log || null,
    failure_reason: todo.failure_reason || null,
    completion_summary: todo.completion_summary || null,
    execution_plan: todo.execution_plan || null,
    execution_report: todo.execution_report || null,
    approval_status: todo.approval_status || null,
    scheduled_time: todo.scheduled_time || null,
    run_post_op: todo.run_post_op,
    plan_generated_at: todo.plan_generated_at || null,
    plan_approved_at: todo.plan_approved_at || null,
  };

  res.json(details);
});

// POST / — create todo
router.post("/", (req, res) => {
  const { title, text, description, priority, context } = req.body;
  const todoTitle = (title || text || "").trim();
  if (!todoTitle) return res.status(400).json({ error: "title is required" });
  if (todoTitle.length > 500) return res.status(400).json({ error: "title too long (max 500 chars)" });
  if (description && description.length > 5000) return res.status(400).json({ error: "description too long (max 5000 chars)" });

  withMutex(TODOS_FILE, async () => {
    const todos = await readTodos();
    const todo = {
      id: randomUUID(),
      task_number: nextTaskNumberSync(),
      title: todoTitle,
      description: description?.trim() || null,
      status: "pending",
      priority: VALID_PRIORITIES.includes(priority) ? priority : "medium",
      context: context?.trim() || null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    todos.unshift(todo);
    await writeTodos(todos);
    logActivity("system", null, `TODO added: ${todoTitle.substring(0, 60)}`);
    res.json({ ok: true, todo });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

// PATCH /:id — update todo
router.patch("/:id", (req, res) => {
  withMutex(TODOS_FILE, async () => {
    const todos = await readTodos();
    const todo = todos.find((t) => t.id === req.params.id);
    if (!todo) return res.status(404).json({ error: "Not found" });

    if (req.body.title !== undefined) todo.title = req.body.title;
    if (req.body.text !== undefined) todo.title = req.body.text; // legacy compat
    if (req.body.description !== undefined) todo.description = req.body.description || null;
    if (req.body.priority !== undefined && VALID_PRIORITIES.includes(req.body.priority)) todo.priority = req.body.priority;
    if (req.body.context !== undefined) todo.context = req.body.context || null;
    if (req.body.plan_details !== undefined) todo.plan_details = req.body.plan_details || null;
    if (req.body.run_log !== undefined) todo.run_log = req.body.run_log || null;
    if (req.body.failure_reason !== undefined) todo.failure_reason = req.body.failure_reason || null;
    if (req.body.completion_summary !== undefined) todo.completion_summary = req.body.completion_summary || null;
    // New planning/scheduling fields
    if (req.body.execution_plan !== undefined) todo.execution_plan = req.body.execution_plan || null;
    if (req.body.execution_report !== undefined) todo.execution_report = req.body.execution_report || null;
    if (req.body.approval_status !== undefined) todo.approval_status = req.body.approval_status || null;
    if (req.body.scheduled_time !== undefined) todo.scheduled_time = req.body.scheduled_time || null;
    if (req.body.run_post_op !== undefined) todo.run_post_op = !!req.body.run_post_op;
    if (req.body.plan_generated_at !== undefined) todo.plan_generated_at = req.body.plan_generated_at || null;
    if (req.body.plan_approved_at !== undefined) todo.plan_approved_at = req.body.plan_approved_at || null;

    if (req.body.status !== undefined && VALID_TODO_STATUSES.has(req.body.status)) {
      const prevStatus = todo.status;
      const isRetry = todo.status === "failed" && req.body.status === "pending";
      todo.status = req.body.status;
      if (req.body.status === "completed" && !todo.completed_at) {
        todo.completed_at = new Date().toISOString();
      }
      if (req.body.status === "pending") {
        todo.completed_at = null;
      }
      if (isRetry) {
        todo.failure_reason = null;
        todo.run_log = null;
        todo.plan_details = null;
      }
      // Trigger /oasis-ops when a todo execution finishes (completed or failed)
      if ((req.body.status === "completed" || req.body.status === "failed") &&
          prevStatus !== req.body.status && todo.run_post_op !== false) {
        runOasisOps(`todo:${todo.title.substring(0, 40)}`);
      }
    }

    await writeTodos(todos);
    res.json({ ok: true, todo });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

// POST /:id/plan — generate execution plan with Claude
router.post("/:id/plan", async (req, res) => {
  const todos = await readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) {return res.status(404).json({ error: "Not found" });}
  if (todo.status === "executing" || todo.status === "completed") {
    return res.status(400).json({ error: `Cannot plan for todo with status '${todo.status}'` });
  }

  // Update status to planning
  await withMutex(TODOS_FILE, async () => {
    const all = await readTodos();
    const t = all.find((x) => x.id === todo.id);
    if (t) {
      t.status = "planning";
      t.approval_status = "pending_plan";
      await writeTodos(all);
    }
  });

  logActivity("system", null, `Planning started: ${todo.title.substring(0, 60)}`);

  const prompt = `Create a detailed execution plan for this OASIS task:

Title: ${todo.title}
${todo.description ? `Description: ${todo.description}` : ""}
${todo.context ? `Context: ${todo.context}` : ""}
Priority: ${todo.priority}

Provide a concise, actionable plan:
1. Step-by-step implementation approach
2. Files to modify or create
3. Risk assessment (low/medium/high)
4. Any prerequisites or dependencies

Be specific and practical. Use markdown formatting.`;

  let output = "";
  let errorOutput = "";

  const child = spawn("claude", ["--print", prompt], {
    cwd: process.env.HOME || "/root",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  todoPlanStreams.set(todo.id, { child, output: "" });

  child.stdout.on("data", (d) => {
    output += d.toString();
    const entry = todoPlanStreams.get(todo.id);
    if (entry) {entry.output = output;}
  });

  child.stderr.on("data", (d) => { errorOutput += d.toString(); });

  child.on("close", async (code) => {
    try {
      await withMutex(TODOS_FILE, async () => {
        const all = await readTodos();
        const t = all.find((x) => x.id === todo.id);
        if (t) {
          t.execution_plan = output.substring(0, 50000);
          t.plan_generated_at = new Date().toISOString();
          if (code === 0 && output.trim()) {
            t.status = "awaiting_approval";
            t.approval_status = "pending_approval";
          } else {
            t.status = "pending";
            t.approval_status = null;
            t.failure_reason = (errorOutput || `Planning exited with code ${code}`).substring(0, 2000);
          }
          await writeTodos(all);
        }
      });
    } catch (e) {
      console.error(`[todo-plan] Failed to update: ${e.message}`);
    }
    todoPlanStreams.delete(todo.id);
    logActivity("system", null, `Plan ${code === 0 ? "generated" : "failed"}: ${todo.title.substring(0, 60)}`);
  });

  child.on("error", async (err) => {
    console.error(`[todo-plan] Spawn failed: ${err.message}`);
    try {
      await withMutex(TODOS_FILE, async () => {
        const all = await readTodos();
        const t = all.find((x) => x.id === todo.id);
        if (t) {
          t.status = "pending";
          t.approval_status = null;
          t.failure_reason = `Plan generation failed: ${err.message}`;
          await writeTodos(all);
        }
      });
    } catch {}
    todoPlanStreams.delete(todo.id);
  });

  res.json({ ok: true, status: "planning", todoId: todo.id });
});

// GET /:id/plan-progress — poll planning output
router.get("/:id/plan-progress", (req, res) => {
  const entry = todoPlanStreams.get(req.params.id);
  if (!entry) {return res.json({ status: "idle", output: "" });}
  res.json({ status: "planning", output: entry.output.substring(0, 50000) });
});

// POST /:id/approve — approve, schedule, or reject a plan
router.post("/:id/approve", (req, res) => {
  const { action, scheduled_time, run_post_op } = req.body;
  if (!action || !["approve", "approve_schedule", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approve', 'approve_schedule', or 'reject'" });
  }

  withMutex(TODOS_FILE, async () => {
    const todos = await readTodos();
    const todo = todos.find((t) => t.id === req.params.id);
    if (!todo) {return res.status(404).json({ error: "Not found" });}
    if (!todo.execution_plan) {return res.status(400).json({ error: "No plan to approve" });}

    if (action === "reject") {
      todo.approval_status = "rejected";
      todo.status = "pending";
      // Keep plan for reference
    } else if (action === "approve" || action === "approve_schedule") {
      todo.approval_status = "approved";
      todo.plan_approved_at = new Date().toISOString();
      if (run_post_op !== undefined) {todo.run_post_op = !!run_post_op;}

      if (action === "approve_schedule" && scheduled_time) {
        todo.scheduled_time = scheduled_time;
        todo.status = "scheduled";
      } else {
        todo.status = "approved";
      }
    }

    await writeTodos(todos);
    logActivity("system", null, `Plan ${action}: ${todo.title.substring(0, 60)}`);
    res.json({ ok: true, todo });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

// POST /:id/replan — discard current plan and reset to pending
router.post("/:id/replan", (req, res) => {
  withMutex(TODOS_FILE, async () => {
    const todos = await readTodos();
    const todo = todos.find((t) => t.id === req.params.id);
    if (!todo) {return res.status(404).json({ error: "Not found" });}

    todo.execution_plan = null;
    todo.approval_status = null;
    todo.plan_generated_at = null;
    todo.plan_approved_at = null;
    todo.scheduled_time = null;
    todo.status = "pending";

    await writeTodos(todos);
    logActivity("system", null, `Plan discarded: ${todo.title.substring(0, 60)}`);
    res.json({ ok: true, todo });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

// POST /:id/execute — execute todo directly with Claude Code (bypass permissions)
router.post("/:id/execute", async (req, res) => {
  const todos = await readTodos();
  const todo = todos.find((t) => t.id === req.params.id);
  if (!todo) {return res.status(404).json({ error: "Not found" });}
  if (todo.status === "executing" || todo.status === "completed") {
    return res.status(400).json({ error: `Cannot execute todo with status '${todo.status}'` });
  }

  await withMutex(TODOS_FILE, async () => {
    const all = await readTodos();
    const t = all.find((x) => x.id === todo.id);
    if (t) {
      t.status = "executing";
      await writeTodos(all);
    }
  });

  logActivity("system", null, `TODO executing: ${todo.title.substring(0, 60)}`);
  executeTask(todo);
  res.json({ ok: true, status: "executing", todoId: todo.id });
});

// GET /:id/progress — get execution progress
router.get("/:id/progress", (req, res) => {
  const entry = todoProgressStreams.get(req.params.id);
  if (!entry) {return res.json({ status: "idle", output: "" });}
  res.json({ status: "executing", output: entry.output.substring(0, 50000) });
});

// DELETE /:id — delete todo (completed tasks cannot be deleted)
router.delete("/:id", (req, res) => {
  withMutex(TODOS_FILE, async () => {
    const todos = await readTodos();
    const idx = todos.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {return res.status(404).json({ error: "Not found" });}
    if (todos[idx].status === "completed") {
      return res.status(400).json({ error: "Cannot delete completed tasks" });
    }
    const removed = todos.splice(idx, 1)[0];
    await writeTodos(todos);
    logActivity("system", null, `TODO removed: ${(removed.title || "").substring(0, 60)}`);
    res.json({ ok: true });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

export default router;
