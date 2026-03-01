/**
 * Voice call response generator - uses the embedded Pi agent for tool support.
 * Routes voice responses through the same agent infrastructure as messaging.
 */

import crypto from "node:crypto";
import type { VoiceCallConfig } from "./config.js";
import { loadCoreAgentDeps, type CoreConfig } from "./core-bridge.js";

export type VoiceResponseParams = {
  /** Voice call config */
  voiceConfig: VoiceCallConfig;
  /** Core OpenClaw config */
  coreConfig: CoreConfig;
  /** Call ID for session tracking */
  callId: string;
  /** Caller's phone number */
  from: string;
  /** Conversation transcript */
  transcript: Array<{ speaker: "user" | "bot"; text: string }>;
  /** Latest user message */
  userMessage: string;
};

export type VoiceResponseResult = {
  text: string | null;
  error?: string;
};

type SessionEntry = {
  sessionId: string;
  updatedAt: number;
};

/**
 * Generate a voice response using the embedded Pi agent with full tool support.
 * Uses the same agent infrastructure as messaging for consistent behavior.
 */
export async function generateVoiceResponse(
  params: VoiceResponseParams,
): Promise<VoiceResponseResult> {
  const { voiceConfig, callId, from, transcript, userMessage, coreConfig } = params;

  if (!coreConfig) {
    return { text: null, error: "Core config unavailable for voice response" };
  }

  let deps: Awaited<ReturnType<typeof loadCoreAgentDeps>>;
  try {
    deps = await loadCoreAgentDeps();
  } catch (err) {
    return {
      text: null,
      error: err instanceof Error ? err.message : "Unable to load core agent dependencies",
    };
  }
  const cfg = coreConfig;

  // Build voice-specific session key based on phone number
  const normalizedPhone = from.replace(/\D/g, "");
  const sessionKey = `voice:${normalizedPhone}`;

  // Resolve agent ID from voice-call config or bindings.
  // Check bindings for a voice-channel match on the caller's number, falling
  // back to the default agent.
  const agentId = resolveVoiceAgentId(cfg, from);

  // Resolve paths
  const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
  const agentDir = deps.resolveAgentDir(cfg, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);

  // Ensure workspace exists
  await deps.ensureAgentWorkspace({ dir: workspaceDir });

  // Load or create session entry
  const sessionStore = deps.loadSessionStore(storePath);
  const now = Date.now();
  let sessionEntry = sessionStore[sessionKey] as SessionEntry | undefined;

  if (!sessionEntry) {
    sessionEntry = {
      sessionId: crypto.randomUUID(),
      updatedAt: now,
    };
    sessionStore[sessionKey] = sessionEntry;
    await deps.saveSessionStore(storePath, sessionStore);
  }

  const sessionId = sessionEntry.sessionId;
  const sessionFile = deps.resolveSessionFilePath(sessionId, sessionEntry, {
    agentId,
  });

  // Resolve model from config
  const modelRef = voiceConfig.responseModel || `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
  const slashIndex = modelRef.indexOf("/");
  const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
  const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

  // Resolve thinking level
  const thinkLevel = deps.resolveThinkingDefault({ cfg, provider, model });

  // Resolve agent identity for personalized prompt
  const identity = deps.resolveAgentIdentity(cfg, agentId);
  const agentName = identity?.name?.trim() || "assistant";

  // Build system prompt with conversation history
  const basePrompt =
    voiceConfig.responseSystemPrompt ??
    `You are ${agentName}, a helpful voice assistant on a live phone call. CRITICAL: Keep responses to 1-2 short sentences. Be natural, warm, and conversational. Never use markdown, lists, or formatting — this is spoken aloud. Do NOT attempt to use tools or perform actions — just respond verbally. The caller's phone number is ${from}.`;

  let extraSystemPrompt = basePrompt;
  if (transcript.length > 0) {
    const history = transcript
      .map((entry) => `${entry.speaker === "bot" ? "You" : "Caller"}: ${entry.text}`)
      .join("\n");
    extraSystemPrompt = `${basePrompt}\n\nConversation so far:\n${history}`;
  }

  // Resolve timeout — default to 10s for voice (must be snappy)
  const timeoutMs = voiceConfig.responseTimeoutMs ?? 10_000;
  const runId = `voice:${callId}:${Date.now()}`;

  try {
    const result = await deps.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      messageProvider: "voice",
      sessionFile,
      workspaceDir,
      config: cfg,
      prompt: userMessage,
      provider,
      model,
      thinkLevel,
      verboseLevel: "off",
      timeoutMs,
      runId,
      lane: "voice",
      extraSystemPrompt,
      agentDir,
    });

    // Extract text from payloads
    const texts = (result.payloads ?? [])
      .filter((p) => p.text && !p.isError)
      .map((p) => p.text?.trim())
      .filter(Boolean);

    const text = texts.join(" ") || null;

    if (!text && result.meta?.aborted) {
      return { text: null, error: "Response generation was aborted" };
    }

    return { text };
  } catch (err) {
    console.error(`[voice-call] Response generation failed:`, err);
    return { text: null, error: String(err) };
  }
}

/**
 * Resolve which agent should handle a voice call based on the caller's phone
 * number.  Checks `bindings` for a voice-channel match first, then falls back
 * to any WhatsApp direct-message binding for the same number, and finally to
 * the default agent.
 */
function resolveVoiceAgentId(cfg: CoreConfig, callerPhone: string): string {
  const bindings = (cfg as Record<string, unknown>).bindings as
    | Array<{
        agentId?: string;
        match?: { channel?: string; peer?: { kind?: string; id?: string } };
      }>
    | undefined;
  if (!bindings) return "main";

  // Normalise phone for comparison (strip non-digit except leading +)
  const norm = (p: string) => p.replace(/[^\d+]/g, "");
  const caller = norm(callerPhone);

  // 1. Exact voice binding
  for (const b of bindings) {
    if (
      b.match?.channel === "voice" &&
      b.match.peer?.kind === "direct" &&
      norm(b.match.peer.id ?? "") === caller
    ) {
      return b.agentId ?? "main";
    }
  }

  // 2. Fall back to WhatsApp direct-message binding for the same number
  for (const b of bindings) {
    if (
      b.match?.channel === "whatsapp" &&
      b.match.peer?.kind === "direct" &&
      norm(b.match.peer.id ?? "") === caller
    ) {
      return b.agentId ?? "main";
    }
  }

  // 3. Default agent
  const agents = (cfg as Record<string, unknown>).agents as
    | { list?: Array<{ id?: string; default?: boolean }> }
    | undefined;
  const defaultAgent = agents?.list?.find((a) => a.default);
  return defaultAgent?.id ?? "main";
}
