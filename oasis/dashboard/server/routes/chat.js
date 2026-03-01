/**
 * OASIS Dashboard v3 - Chat Routes
 * POST /api/chat/stream — SSE streaming chat
 * GET  /api/chat/sessions — list sessions
 * GET  /api/chat/sessions/:id — get session messages
 * POST /api/chat/sessions — create new session
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { rpcCall } from "../services/gateway-client.js";

const router = Router();

/**
 * Extract plain text from a chat history message.
 * Handles multiple content formats returned by the gateway:
 * - Plain string: msg.text = "hello"
 * - Parts array:  msg.text = [{type:"text", text:"hello"}]
 * - Parts field:  msg.parts = [{type:"text", text:"hello"}]
 * - Content field: msg.content = "hello"
 */
function extractTextFromMessage(msg) {
  // Try each field that might contain the response
  for (const field of [msg.text, msg.content, msg.parts, msg.message]) {
    if (typeof field === "string" && field) {return field;}
    if (Array.isArray(field)) {
      // Concatenate all text parts
      const texts = field
        .map((p) =>
          typeof p === "string" ? p : typeof p?.text === "string" ? p.text : null
        )
        .filter(Boolean);
      if (texts.length > 0) {return texts.join("");}
    }
  }
  if (typeof msg === "string" && msg) {return msg;}
  return null;
}

// POST /stream — SSE streaming chat
// Sends message to agent via gateway RPC, waits for completion, fetches response.
// The gateway "agent" RPC is fire-and-forget (returns {status:"accepted"} immediately).
// We use "agent.wait" to block until the agent finishes, then "chat.history" to
// retrieve the actual response text from the session transcript.
router.post("/stream", async (req, res) => {
  const { message, agentId, sessionKey } = req.body;
  if (!message) {return res.status(400).json({ error: "message is required" });}
  if (!agentId) {return res.status(400).json({ error: "agentId is required" });}

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  function sendEvent(type, data) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Send immediate "thinking" feedback
  sendEvent("thinking", { text: "Thinking..." });

  let warningTimer = null;

  try {
    const idempotencyKey = randomUUID();
    const resolvedSessionKey = sessionKey || `agent:${agentId}:${idempotencyKey}`;
    const params = {
      agentId,
      message,
      idempotencyKey,
      deliver: false,
      sessionKey: resolvedSessionKey,
    };

    // Send a follow-up thinking event after 30s if the gateway is still processing
    warningTimer = setTimeout(() => {
      try {
        sendEvent("thinking", { text: "Still processing, this may take a moment..." });
      } catch {}
    }, 30_000);

    // Step 1: Send the message — gateway returns immediately with { runId, status: "accepted" }
    const accepted = await rpcCall("agent", params, 300_000);
    const runId = accepted?.runId || idempotencyKey;

    // Step 2: Wait for the agent's initial response.
    // Use a short agent.wait first (30s) — the main response text is usually
    // available quickly. Subagent chains (spawns, tool use) may run longer but
    // the user-facing reply is in the transcript before they finish.
    let waitDone = false;
    try {
      const waitResult = await rpcCall("agent.wait", { runId, timeoutMs: 30_000 }, 45_000);
      if (waitResult?.status === "error" || waitResult?.error) {
        // Agent errored — still try to fetch response from history in case
        // there was a partial reply before the error.
      } else if (waitResult?.status !== "timeout") {
        waitDone = true;
      }
    } catch {
      // agent.wait failed (e.g. RPC timeout) — fall through to polling
    }

    clearTimeout(warningTimer);
    warningTimer = null;

    // Step 3: Fetch the agent's response from the session transcript.
    // Poll chat.history — the response may already be there even if agent.wait
    // timed out (subagent work continues in background).
    let text = null;
    const maxPollMs = waitDone ? 0 : 150_000; // skip polling if wait already completed
    const pollIntervalMs = 5_000;
    const pollStart = Date.now();

    for (;;) {
      try {
        const history = await rpcCall(
          "chat.history",
          { sessionKey: resolvedSessionKey, limit: 10 },
          15_000
        );
        const messages = history?.messages || history || [];
        if (Array.isArray(messages)) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const role = msg?.role || msg?.type;
            if (role === "assistant" || role === "agent" || role === "bot") {
              text = extractTextFromMessage(msg);
              break;
            }
          }
        }
      } catch (historyErr) {
        console.error("[chat/stream] chat.history failed:", historyErr.message);
      }

      // Got a response or exceeded max polling time
      if (text || Date.now() - pollStart >= maxPollMs) {break;}

      // Wait before next poll
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    if (text) {
      sendEvent("token", { text });
    } else {
      sendEvent("error", { text: "Agent timed out — please try again" });
    }

    sendEvent("done", { runId, sessionKey: resolvedSessionKey });
    res.end();
  } catch (err) {
    if (warningTimer) {clearTimeout(warningTimer);}
    try {
      sendEvent("error", { text: err.message });
      res.end();
    } catch {}
  }
});

// GET /sessions — list chat sessions
router.get("/sessions", async (req, res) => {
  try {
    const params = {
      limit: 100,
      activeMinutes: 1440,
      includeLastMessage: true,
      includeDerivedTitles: true,
    };
    if (req.query.agentId) {params.agentId = req.query.agentId;}
    const result = await rpcCall("sessions.list", params);
    res.json(result || { sessions: [] });
  } catch (err) {
    res.json({ sessions: [], error: err.message });
  }
});

// GET /sessions/:id — get session messages
router.get("/sessions/:id", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.id);
    // Gateway uses "chat.history" (not "sessions.history")
    const result = await rpcCall("chat.history", { sessionKey: key, limit: 100 }, 15_000);
    res.json(result || { messages: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions — create new session (returns a new session key for the given agent)
router.post("/sessions", async (req, res) => {
  try {
    const { agentId, title } = req.body;
    if (!agentId) {return res.status(400).json({ error: "agentId is required" });}

    const sessionKey = `agent:${agentId}:${randomUUID()}`;
    // Initialize via gateway if supported, otherwise just return the key
    try {
      await rpcCall("sessions.create", { agentId, key: sessionKey, title: title || null });
    } catch {
      // sessions.create may not exist; client will create on first message
    }

    res.json({ ok: true, sessionKey, agentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
