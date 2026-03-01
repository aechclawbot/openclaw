# OASIS System Architecture & Technical Specification

> **Generated:** 2026-02-28
> **Scope:** Full static analysis of the OpenClaw OASIS deployment — Docker infrastructure, web frontend, audio processing pipeline, and multi-agent system.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Docker Infrastructure](#2-docker-infrastructure)
3. [Website / Frontend (Control UI & Dashboard)](#3-website--frontend-control-ui--dashboard)
4. [Audio Processing Pipeline](#4-audio-processing-pipeline)
5. [OpenClaw Agent System](#5-openclaw-agent-system)
6. [Component Workflows](#6-component-workflows)
7. [API / Interface Contracts](#7-api--interface-contracts)
8. [Security Architecture](#8-security-architecture)
9. [Operational Runbooks](#9-operational-runbooks)

---

## 1. System Overview

### 1.1 Context (C4 Level 1)

OASIS is a self-hosted AI agent orchestration platform built on top of [OpenClaw](https://github.com/openclaw/openclaw). It runs on a local Mac host (macOS Darwin) and provides:

- **Multi-agent swarm** — 11 specialized AI agents with distinct roles, tools, and subagent delegation graphs
- **Multi-channel messaging** — Telegram, WhatsApp, voice calls (Telnyx), and a web-based Control UI
- **Ambient audio intelligence** — Always-on microphone pipeline with VAD, cloud transcription (AssemblyAI), local speaker identification (SpeechBrain), and voice-command dispatch
- **Web dashboard** — Real-time system monitoring, Docker management, transcript browsing, TODO workflow, and chat bridge
- **Automated operations** — Weekly upstream sync, health monitoring, cron-scheduled agent tasks, and backup verification

### 1.2 High-Level Architecture

```
                          +-----------------------+
                          |     External Users     |
                          | (Telegram, WhatsApp,   |
                          |  Voice Calls, Web UI)  |
                          +-----------+-----------+
                                      |
                          +-----------v-----------+
                          |   macOS Host (OASIS)   |
                          |  launchd services      |
                          |  PulseAudio bridge     |
                          +-----------+-----------+
                                      |
              +----------+------------+-----------+-----------+
              |          |            |           |           |
        +-----v----+ +--v------+ +---v------+ +--v------+ +--v--------+
        | openclaw- | | oasis-  | | audio-   | | docker- | | openclaw- |
        | gateway   | | dashboard| | listener | | socket- | | cli       |
        | (oasis)   | |         | |          | | proxy   | | (on-demand)|
        +----------+ +---------+ +----------+ +---------+ +-----------+
              |            |           |
        Agent Runtime   Web UI    Audio Pipeline
        Channels        Docker Mgmt   VAD + STT + Speaker ID
        Hooks API       TODO System   Voice Commands
        Cron Jobs       Transcripts   Transcript Sync
```

### 1.3 Technology Stack Summary

| Layer           | Technology                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| **Runtime**     | Node.js 22+ (gateway), Python 3.11 (audio), Bun (dev/scripts)                 |
| **Language**    | TypeScript (ESM, strict), Python 3                                            |
| **Framework**   | OpenClaw core (custom agent framework), Express-like HTTP, WebSocket (`ws`)   |
| **Frontend**    | Lit (Web Components), Vite 7.3, Lit Signals, Marked + DOMPurify               |
| **AI Models**   | Gemini 2.5 Flash (primary), Claude Sonnet/Haiku (fallback), GPT-4o (fallback) |
| **Audio ML**    | SpeechBrain ECAPA-TDNN (speaker ID), WebRTC VAD, AssemblyAI Universal-2       |
| **Voice Calls** | Telnyx Call Control API, OpenAI Realtime STT, mu-law G.711 codec              |
| **Container**   | Docker Compose, bridge network, json-file logging                             |
| **Channels**    | Telegram, WhatsApp (web), Telnyx voice, OpenClaw Control UI                   |
| **Build**       | pnpm, Vite, TypeScript (tsgo), Oxlint/Oxfmt                                   |
| **Host OS**     | macOS (Darwin 24.6.0), launchd services                                       |

---

## 2. Docker Infrastructure

### 2.1 Container Architecture (C4 Level 2)

```
+----------------------------------------------------------------------+
|                        Docker Compose Stack                           |
|  Network: openclaw (bridge)                                          |
|                                                                      |
|  +-------------------+   +------------------+   +------------------+ |
|  | openclaw-gateway   |   | oasis-dashboard  |   | audio-listener   | |
|  | (oasis)            |   |                  |   |                  | |
|  | Node.js 22         |   | Node.js          |   | Python 3.11      | |
|  | Port: 18789 (LAN)  |   | Port: 3000 (LAN) |   | Port: 9001 (lo)  | |
|  | Mem: 4GB, CPU: 2.0 |   | Mem: 512MB       |   | Mem: 6GB, CPU: 2 | |
|  +--------+-----------+   +-------+----------+   +--------+---------+ |
|           |                        |                       |          |
|           |   +------------------+ |                       |          |
|           +-->| docker-socket-   |<+                       |          |
|               | proxy            |                         |          |
|               | Port: 2375 (int) |                         |          |
|               +------------------+                         |          |
|                                                            |          |
|  +-------------------+                                     |          |
|  | openclaw-cli       |   (profile: cli, on-demand)        |          |
|  | Interactive TTY    |                                    |          |
|  +-------------------+                                     |          |
+----------------------------------------------------------------------+
          |            |           |
    Host Volumes   PulseAudio   Docker Socket
                   TCP Bridge   (read-only)
```

### 2.2 Services

#### 2.2.1 openclaw-gateway (`oasis`)

| Property      | Value                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| **Image**     | `${OPENCLAW_IMAGE:-openclaw:local}` (built from `Dockerfile` + `Dockerfile.oasis`)    |
| **Container** | `oasis`                                                                               |
| **Command**   | `node dist/index.js gateway --bind ${OPENCLAW_GATEWAY_BIND:-lan} --port 18789`        |
| **Ports**     | `0.0.0.0:18789` (gateway), `127.0.0.1:18790` (bridge), `127.0.0.1:3334`               |
| **Resources** | 4GB memory, 2.0 CPUs, 256 max PIDs                                                    |
| **Health**    | TCP check on `localhost:18789`, 30s interval, 3 retries                               |
| **Key Env**   | `JITI_CACHE=false`, `NODE_OPTIONS=--max-old-space-size=3072`, all API keys via `.env` |

**Volumes:**

- `${OPENCLAW_CONFIG_DIR}` -> `/home/node/.openclaw` (config + state)
- `${OPENCLAW_WORKSPACE_DIR}` -> `/home/node/.openclaw/workspace` (agent workspaces)
- `./dist` -> `/app/dist:ro` (built JS output)
- Voice-call extension patches (4 files, read-only, with `JITI_CACHE=false` to bypass stale cache)

#### 2.2.2 oasis-dashboard

| Property       | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| **Image**      | Built from `${OPENCLAW_CONFIG_DIR}/workspace-oasis/dashboard` |
| **Container**  | `oasis-dashboard`                                             |
| **Command**    | `node server.js`                                              |
| **Port**       | `0.0.0.0:3000`                                                |
| **Resources**  | 512MB memory, 0.5 CPUs, 128 max PIDs                          |
| **Health**     | HTTP GET `/api/health`, 30s interval                          |
| **Depends On** | `openclaw-gateway` (healthy), `docker-socket-proxy` (started) |
| **User**       | `1000:1000` (non-root)                                        |

**Key Env:**

- `GATEWAY_URL=ws://oasis:18789` (WebSocket to gateway)
- `DOCKER_HOST=http://docker-proxy:2375` (Docker socket proxy)
- `AUDIO_DONE_DIR=/audio/done`, `AUDIO_INBOX_DIR=/audio/inbox`
- `AUDIO_LISTENER_URL=http://audio-listener:9001`
- Dashboard credentials via `.env`

#### 2.2.3 audio-listener

| Property      | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| **Image**     | Built from `./audio-listener/Dockerfile` (Python 3.11-slim)         |
| **Container** | `audio-listener`                                                    |
| **Command**   | `python /app/app.py`                                                |
| **Port**      | `127.0.0.1:9001` (loopback only)                                    |
| **Resources** | 6GB memory limit, 512MB reservation, 2.0 CPUs, `oom_score_adj: 500` |
| **Health**    | HTTP GET `http://localhost:9001/health`, 30s interval               |

**Volumes:**

- `~/oasis-audio/inbox` -> `/audio/inbox` (WAV files)
- `~/oasis-audio/done` -> `/audio/done` (transcripts)
- `~/.openclaw/voice-profiles` -> `/voice-profiles`
- `~/.openclaw/unknown-speakers` -> `/unknown-speakers`
- Source files mounted read-only (app.py, speaker_verify.py, assemblyai_transcriber.py)

**Key Env:**

- `PULSE_SERVER=tcp:host.docker.internal:4713` (PulseAudio bridge)
- `SAMPLE_RATE=16000`, `VAD_AGGRESSIVENESS=3`
- `ASSEMBLYAI_API_KEY` (via `.env`)
- `VERIFY_SPEAKER=true`, `SPEAKER_ID_ENABLED=true`
- `QUIET_HOURS=23-06`

#### 2.2.4 docker-socket-proxy

| Property      | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| **Image**     | `tecnativa/docker-socket-proxy`                            |
| **Container** | `docker-proxy`                                             |
| **Security**  | `cap_drop: ALL`, `no-new-privileges`                       |
| **Allowed**   | `CONTAINERS=1`, `POST=1` (list/inspect/stop/start/restart) |
| **Blocked**   | Images, Volumes, Networks, Exec, Build, Commit, Swarm      |

### 2.3 Network Topology

All services connect to the `openclaw` bridge network. Internal DNS resolves container names.

| Source         | Destination           | Protocol  | Purpose                            |
| -------------- | --------------------- | --------- | ---------------------------------- |
| Dashboard      | `oasis:18789`         | WebSocket | Agent chat, config, status         |
| Dashboard      | `docker-proxy:2375`   | HTTP      | Container management               |
| Dashboard      | `audio-listener:9001` | HTTP      | Speaker labeling, health           |
| Audio-listener | `oasis:18789`         | HTTP POST | Voice command dispatch (hooks API) |
| External       | `0.0.0.0:18789`       | HTTP/WS   | Gateway API (LAN)                  |
| External       | `0.0.0.0:3000`        | HTTP      | Dashboard UI                       |

### 2.4 Image Build Chain

```
node:22-bookworm (base)
    |
    v
Dockerfile -> openclaw:local
    |  pnpm install, pnpm build, pnpm ui:build
    |  Optional: Playwright Chromium
    v
Dockerfile.oasis -> openclaw:oasis
    |  ffmpeg, jq, python3, git, curl, chromium
    |  ngrok, openai-whisper (via uv), clawhub, viem
    v
docker-compose.yml services
```

### 2.5 Security Hardening

All containers apply:

- `cap_drop: [ALL]` — no Linux capabilities
- `security_opt: no-new-privileges:true` — prevents setuid/setgid escalation
- Non-root runtime users (`node:node` or `1000:1000`)
- Read-only source mounts (`:ro`)
- Docker socket proxied with minimal API surface
- Logging: `json-file`, 10MB max, 3 rotated files (~30MB/container)

### 2.6 Environment & Secrets

All secrets stored in `.env` at repo root, injected via `env_file: .env`:

| Category           | Variables                                                                           |
| ------------------ | ----------------------------------------------------------------------------------- |
| **Model API Keys** | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`                             |
| **Channel Tokens** | `TELEGRAM_BOT_TOKEN`                                                                |
| **Voice/Audio**    | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_CONNECTION_ID`, `ASSEMBLYAI_API_KEY` |
| **Gateway**        | `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_CONFIG_DIR`, `OPENCLAW_WORKSPACE_DIR`           |
| **Dashboard**      | `OPENCLAW_DASHBOARD_USERNAME`, `OPENCLAW_DASHBOARD_PASSWORD`                        |
| **Services**       | `BRAVE_SEARCH_API_KEY`, `NGROK_AUTHTOKEN`, `HF_TOKEN`                               |
| **Ethereum**       | `NOLAN_ETH_PRIVATE_KEY`, `OASIS_ETH_PRIVATE_KEY`, `AECH_ETH_PRIVATE_KEY`            |

---

## 3. Website / Frontend (Control UI & Dashboard)

### 3.1 Architecture Overview

There are two distinct web interfaces:

1. **OpenClaw Control UI** — Built-in SPA served by the gateway at port 18789, built with Lit Web Components + Vite
2. **OASIS Dashboard** — Custom Node.js server at port 3000, purpose-built for OASIS-specific monitoring, Docker management, and audio transcripts

### 3.2 OpenClaw Control UI

#### 3.2.1 Tech Stack

| Component       | Technology                                           |
| --------------- | ---------------------------------------------------- |
| **Framework**   | Lit (Web Components) with `@state()` decorators      |
| **Build**       | Vite 7.3.1 (output: `/dist/control-ui/`)             |
| **State**       | Lit Signals + `@lit-labs/signals` for reactive state |
| **Routing**     | Client-side SPA with history API                     |
| **Styling**     | CSS Custom Properties (Dark/Light/System themes)     |
| **Markdown**    | Marked 17.0.3 + DOMPurify 3.3.1                      |
| **Auth Crypto** | @noble/ed25519 3.0.0 (device auth signing)           |
| **i18n**        | Custom controller supporting en, zh-CN, zh-TW, pt-BR |
| **Testing**     | Vitest 4.0.18 + Playwright browser tests             |

#### 3.2.2 Server-Side

The gateway HTTP server (`src/gateway/server-http.ts` + `src/gateway/control-ui.ts`) serves:

- **SPA Root** `/` — `index.html` with SPA fallback for unknown routes
- **Bootstrap Config** `/__openclaw/control-ui-config.json` — provides `basePath`, `assistantName`, `assistantAvatar`, `assistantAgentId`
- **Avatar Proxy** `/avatar/{agentId}` — proxies agent avatars with `?meta=1` metadata support
- **Security Headers** — `X-Frame-Options: DENY`, CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`

#### 3.2.3 Client Connection

`GatewayBrowserClient` (`ui/src/ui/gateway.ts`):

- WebSocket with auto-reconnect (exponential backoff: 800ms -> 15s)
- JSON frame-based request-response with unique IDs
- Auth: token (from URL fragment) or password
- Device identity: ECDSA Ed25519 signing with per-device public key
- Client instance: UUID per browser session (`clientInstanceId`)

#### 3.2.4 Navigation Tabs

| Tab       | Route        | Purpose                                                               |
| --------- | ------------ | --------------------------------------------------------------------- |
| Chat      | `/chat`      | Message history, streaming, tool output sidebar, thinking display     |
| Overview  | `/overview`  | Connection status, uptime, session count, next cron run               |
| Channels  | `/channels`  | Per-channel config (Discord, Telegram, WhatsApp, Signal, Slack, etc.) |
| Instances | `/instances` | Connected nodes/devices, pairing workflows                            |
| Sessions  | `/sessions`  | Session list, filtering, preview, reset/delete                        |
| Usage     | `/usage`     | Token/cost tracking, time series charts, role/tool filtering          |
| Cron      | `/cron`      | Job list, CRON expression editor, execution history                   |
| Agents    | `/agents`    | Agent list: overview, files, tools, skills, channels, cron            |
| Skills    | `/skills`    | Install, enable/disable, API key management                           |
| Nodes     | `/nodes`     | Node descriptors, device approval, execution policies                 |
| Config    | `/config`    | Dual mode: Form UI + Raw JSON, schema validation, search              |
| Debug     | `/debug`     | Health snapshot, status, model availability                           |
| Logs      | `/logs`      | Tail logs with filtering, level controls, CSV export                  |

#### 3.2.5 State Persistence

`localStorage` key: `openclaw.control.settings.v1`

Persisted: `gatewayUrl`, `token`, `sessionKey`, `theme`, `chatFocusMode`, `chatShowThinking`, `splitRatio`, `navCollapsed`, `navGroupsCollapsed`, `locale`

### 3.3 OASIS Dashboard

#### 3.3.1 Architecture

The custom dashboard (`~/.openclaw/workspace-oasis/dashboard/`) is a Node.js Express server with static HTML pages:

- **Server**: `server.js` — Express with HTTP basic auth
- **Auth**: `OPENCLAW_DASHBOARD_USERNAME` / `OPENCLAW_DASHBOARD_PASSWORD`
- **Static Assets**: `public/` directory (HTML, CSS, JS)

#### 3.3.2 Pages & Features

| Page          | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `index.html`  | System overview, health status, quick stats                                             |
| `docker.html` | Docker container grid (CPU, memory, uptime, restart count), stop/start/restart controls |
| `chat.html`   | AI chat bridge using Gemini with OASIS context                                          |
| `recipe.html` | Meal planning / recipe display                                                          |

#### 3.3.3 Dashboard API Endpoints

| Method | Path                                   | Purpose                                  |
| ------ | -------------------------------------- | ---------------------------------------- |
| GET    | `/api/health`                          | Health check (Docker healthcheck target) |
| GET    | `/api/docker/containers`               | List all containers with stats           |
| POST   | `/api/docker/containers/:name/stop`    | Stop a container                         |
| POST   | `/api/docker/containers/:name/start`   | Start a container                        |
| POST   | `/api/docker/containers/:name/restart` | Restart a container                      |
| POST   | `/api/docker/restart-all`              | Restart all containers                   |
| POST   | `/api/docker/rebuild`                  | Trigger weekly update/rebuild script     |

#### 3.3.4 Integrations

- **Docker Management** via `DOCKER_HOST=http://docker-proxy:2375`
- **TODO System** reads/writes `~/.openclaw/dashboard-todos.json` (flat JSON array)
- **Voice Transcripts** reads from `AUDIO_DONE_DIR` and curator workspace
- **Chat Bridge** uses Gemini API (`GEMINI_API_KEY`) with OASIS system context
- **Audio Listener** communicates with `AUDIO_LISTENER_URL=http://audio-listener:9001` for speaker labeling

---

## 4. Audio Processing Pipeline

### 4.1 Pipeline Overview (C4 Level 3)

```
  Microphone (PulseAudio TCP bridge)
       |
       v
  +----+----+
  | PyAudio  | (16kHz, 16-bit PCM mono)
  +----+----+
       |
       v
  +----+----+
  | WebRTC   | Voice Activity Detection
  | VAD      | (aggressiveness: 0-3)
  +----+----+
       |
       v
  +----+--------+
  | Noise Gate   | RMS threshold: 0.03
  | + Adaptive   | Min speech: 1.5s
  | Silence      | Max segment: 1800s
  +----+---------+ Adaptive silence: 3.0-8.0s
       |
       v
  +----+----+
  | WAV File | -> ~/oasis-audio/inbox/recording_YYYYMMDD_HHMMSS.wav
  +----+----+
       |
       v (daemon thread)
  +----+-----------+
  | AssemblyAI     | Universal-2 model
  | Transcription  | + Speaker diarization
  | + Diarization  | + Language detection
  +----+-----------+ Cost: $0.17/hour
       |
       v
  +----+-----------+
  | SpeechBrain    | ECAPA-TDNN (192-dim embeddings)
  | Speaker ID     | Cosine distance matching
  +----+-----------+ Threshold: 0.20-0.50 adaptive
       |
       +--------> ~/oasis-audio/done/{stem}.json (enriched transcript)
       |
       v
  +----+-----------+
  | Voice Command  | Agent trigger detection
  | Detection      | Speaker authorization
  +----+-----------+ Dispatch to gateway hooks API
       |
       v
  +----+-----------+
  | Transcript     | sync-transcripts.py daemon
  | Sync Bridge    | Readiness gates (status checks)
  +----+-----------+ -> ~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/
```

### 4.2 VAD Listener (Main Thread)

The listener runs continuously in `app.py`, reading from the microphone via PyAudio:

| Parameter                    | Default  | Purpose                                                |
| ---------------------------- | -------- | ------------------------------------------------------ |
| `SAMPLE_RATE`                | 16000 Hz | Audio sample rate                                      |
| `VAD_AGGRESSIVENESS`         | 3        | WebRTC VAD sensitivity (0-3, higher = more aggressive) |
| `MIN_SPEECH_SECONDS`         | 1.5s     | Minimum speech to save segment                         |
| `MAX_SEGMENT_SECONDS`        | 1800s    | Force-split long segments (30 min)                     |
| `SILENCE_TIMEOUT`            | 4.0s     | Base silence detection timeout                         |
| `SILENCE_TIMEOUT_MIN`        | 3.0s     | Minimum adaptive timeout                               |
| `SILENCE_TIMEOUT_MAX`        | 8.0s     | Maximum adaptive timeout                               |
| `SILENCE_GROW_AFTER_SECONDS` | 30s      | Start growing timeout after this duration              |
| `NOISE_GATE_RMS`             | 0.03     | Audio level threshold                                  |
| `QUIET_HOURS`                | 23-06    | No processing during these hours                       |

Frame size: 480 samples (30ms at 16kHz). Segments are written atomically to `/audio/inbox/`.

### 4.3 AssemblyAI Transcription

| Property          | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| **Model**         | Universal-2                                                       |
| **Features**      | Speaker diarization, language detection                           |
| **Max Speakers**  | 6 (configurable)                                                  |
| **Min Duration**  | 10s (`MIN_TRANSCRIBE_SECONDS`) — shorter clips skip transcription |
| **Poll Interval** | 5 seconds                                                         |
| **Timeout**       | 30 minutes                                                        |
| **Cost**          | $0.15/hr base + $0.02/hr diarization = $0.17/hr                   |
| **Cost Tracking** | `/audio/done/.assemblyai-cost.json`                               |

### 4.4 Speaker Identification

#### 4.4.1 Model

- **Architecture**: SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`)
- **Embedding**: 192-dimensional, L2-normalized
- **Distance Metric**: Cosine distance (`1 - dot_product`)
- **Backend**: PyTorch CPU (`torch==2.10.0+cpu`)

#### 4.4.2 Identification Pipeline

1. Extract multi-segment embeddings (up to 3 longest segments >= 1s)
2. Average embeddings, L2-normalize result
3. Compare against all enrolled profiles using cosine distance
4. Match if distance < profile's adaptive threshold
5. Unmatched speakers tracked in unknown-speaker clusters

#### 4.4.3 Voice Profiles

Location: `~/.openclaw/voice-profiles/{name}.json`

```json
{
  "name": "fred",
  "enrolledAt": "ISO timestamp",
  "enrollmentMethod": "manual-label|manual-enroll|auto-candidate",
  "numSamples": 5,
  "embeddingDimensions": 192,
  "embeddings": [[...192 floats...], ...],
  "threshold": 0.38,
  "selfConsistency": 0.1255,
  "lastUpdated": "ISO timestamp"
}
```

**Auto-Threshold**: `clamp(self_consistency * 3, min=0.20, max=0.50)`

**Quality Gates** (for auto-enrollment candidates):

- Variance < 20.0
- Self-consistency < 0.15
- Minimum 10 samples collected

#### 4.4.4 Enrollment Methods

| Method              | Script                | Description                                            |
| ------------------- | --------------------- | ------------------------------------------------------ |
| Interactive         | `enroll_speaker.py`   | 6 guided 20-second recording samples                   |
| Dashboard Label     | POST `/label-speaker` | Extract embeddings from transcript, merge with profile |
| Candidate Promotion | `approve_speaker.py`  | Promote unknown cluster to enrolled profile            |

#### 4.4.5 Unknown Speaker Tracking

- Embeddings stored: `/unknown-speakers/embeddings/{cluster_id}/*.npy`
- Clustering threshold: 0.20 cosine distance
- Candidate profiles created at `/unknown-speakers/candidates/` after 10+ samples
- Stale clusters pruned every 6 hours (< 3 samples, not updated in 30 days)

### 4.5 Voice Command Detection

When a transcript is ready and the speaker is verified:

1. Scan first 20 characters for agent trigger phrases (longest match first)
2. Extract command text after trigger
3. Check speaker against `VOICE_COMMAND_ALLOWED_SPEAKERS` whitelist
4. Dispatch to gateway: `POST http://oasis:18789/hooks/agent`

**Agent Triggers:**

| Agent     | Trigger Phrases                          |
| --------- | ---------------------------------------- |
| `oasis`   | "hey oasis", "oasis", "ohasis"           |
| `aech`    | "hey aech", "hey h", "aech"              |
| `curator` | "hey curator", "the curator", "curator"  |
| `art3mis` | "hey artemis", "artemis"                 |
| `ogden`   | "hey ogden", "ogden morrow", "ogden"     |
| `ir0k`    | "hey irok", "irok", "i rok"              |
| `nolan`   | "hey nolan", "nolan"                     |
| `dito`    | "hey dito", "hey ditto", "dito", "ditto" |
| `anorak`  | "hey anorak", "anorak", "anna rack"      |

### 4.6 Voice Call Extension (Telnyx)

#### 4.6.1 Architecture

The voice-call extension (`extensions/voice-call/`) manages bidirectional phone calls:

```
Telnyx Call Control API
    |
    v (webhooks)
+---+------------+
| Webhook Handler | (normalize events)
+---+------------+
    |
    v
+---+------------+
| Call Manager    | State machine per call
| (store.ts)     | Active calls map, JSONL persistence
+---+------------+
    |
    +---> Response Generator (agent invocation)
    +---> Media Stream Handler (WebSocket, OpenAI Realtime STT)
    +---> TTS Pipeline (text -> PCM -> mu-law 8kHz -> Telnyx)
```

**Call States**: `initiated -> ringing -> answered -> active -> [speaking|listening] -> completed/ended`

#### 4.6.2 Response Generation

1. Resolve agent from caller's phone number (via bindings)
2. Build voice-specific system prompt (1-2 sentence constraint)
3. Run embedded agent with 10s timeout
4. Return text response for TTS playback

#### 4.6.3 Audio Format Conversion

- **Input**: PCM 16-bit LE mono (variable sample rate)
- **Output**: mu-law 8kHz (G.711), 20ms frames (160 bytes)
- **Conversion**: Resample to 8kHz (linear interpolation) -> mu-law encoding -> chunking

#### 4.6.4 Patched Files (Volume-Mounted)

Four files are patched locally and volume-mounted into the gateway container with `JITI_CACHE=false`:

- `manager/outbound.ts` — Outbound call handling
- `webhook.ts` — Webhook event normalization
- `providers/telnyx.ts` — Telnyx API client
- `response-generator.ts` — Agent invocation for voice responses

### 4.7 Transcript Sync Bridge

`scripts/voice/sync-transcripts.py` runs as a continuous daemon polling every 5 seconds:

**Readiness Gates:**

| Pipeline Status               | Action                                     |
| ----------------------------- | ------------------------------------------ |
| `skipped_too_short`           | Mark synced, skip content                  |
| `transcribed`                 | Wait (speaker ID not done)                 |
| `speaker_id_failed`           | Wait max 7 days, then sync without names   |
| `complete` + all unidentified | Wait 2 hours (grace period for enrollment) |
| `complete`                    | Sync with identified names                 |
| `complete_no_speaker_id`      | Sync (speaker ID disabled)                 |
| Legacy (no status)            | Backward-compatible sync                   |

**Output**: `~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/HH-MM-SS[-diarized].json`

### 4.8 Performance Characteristics

| Metric                 | Value                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| **Container Memory**   | 6GB limit (SpeechBrain + PyTorch: ~2-3GB)                                        |
| **CPU**                | 2.0 cores limit                                                                  |
| **OOM Priority**       | `oom_score_adj: 500` (killed first under pressure)                               |
| **Concurrency**        | Main thread (VAD) + daemon threads (transcription) + background (retry, pruning) |
| **Frame Processing**   | Real-time (480 samples / 30ms)                                                   |
| **Transcription Cost** | $0.17/hour                                                                       |
| **Min Transcribe**     | 10s (cost gate)                                                                  |
| **Max Segment**        | 30 minutes (forced split)                                                        |
| **Audio Retention**    | 30 days                                                                          |

### 4.9 Compatibility Patches

The audio-listener requires three runtime patches for library compatibility:

1. **torchaudio 2.10**: `list_audio_backends()` removed -> patched to return `["soundfile"]`
2. **huggingface_hub 1.0**: `use_auth_token` kwarg deprecated -> stripped from all HF API calls
3. **SpeechBrain custom.py 404**: pre-created empty file at `/tmp/speechbrain-ecapa/custom.py`

Manual WAV loading (via `wave` stdlib) avoids torchaudio backend issues entirely for audio I/O.

---

## 5. OpenClaw Agent System

### 5.1 Agent Registry

11 agents are deployed, each with a dedicated workspace under `~/.openclaw/workspace-{agentId}/`:

| Agent ID       | Name           | Role                                                                | Emoji |
| -------------- | -------------- | ------------------------------------------------------------------- | ----- |
| `oasis`        | OASIS          | Command center AI — gateway orchestrator of the agent swarm         | `🌐`  |
| `oasis-social` | OASIS          | Social AI assistant — warm, conversational companion for contacts   | `🌐`  |
| `aech`         | Aech           | Digital mechanic — aggressive arbitrage engine, elite Gunter        | `⚡`  |
| `anorak`       | Anorak         | Household operations wizard — meal planning, shopping, deal hunting | `🧙‍♂️`  |
| `art3mis`      | Art3mis        | Security firewall — vets links, contracts, and deals                | `🛡️`  |
| `curator`      | The Curator    | Universal archivist — records, indexes, and retrieves everything    | `📚`  |
| `dito`         | Dito           | Web developer and business builder — ships demo websites            | `🔨`  |
| `ir0k`         | I-r0k          | Intelligence broker — deep research and comprehensive dossiers      | `🕵️`  |
| `nolan`        | Nolan          | Autonomous market agent — hunts bounties on Clawlancer marketplace  | `🎯`  |
| `ogden`        | Ogden Morrow   | Risk and ethical advisor — long-term stability strategist           | `🧙`  |
| `main`         | (unconfigured) | Default template agent                                              | —     |

### 5.2 Agent Configuration

Each agent is configured in `~/.openclaw/openclaw.json` under `agents.list[]` with:

- **Model**: Primary `gemini/gemini-2.5-flash` with fallbacks to Gemini 2.5 Pro, Claude Haiku, GPT-4o-mini, GPT-4o
- **Workspace**: Directory path for IDENTITY.md, SOUL.md, DIRECTIVES.md, MEMORY.md, tools.md, models.json
- **Tools**: Explicit allow-list per agent
- **Subagents**: Explicit delegation graph per agent
- **Identity**: Name, theme description, emoji

### 5.3 Tool Access Matrix

| Agent            | Tools                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **oasis**        | `message`, `group:sessions`, `group:web`, `agents_list`, `read`, `image`, `group:plugins`, `voice_call`, `exec`, `browser` |
| **oasis-social** | `group:web`, `session_status`, `voice_call`                                                                                |
| **aech**         | `group:web`, `message`, `session_status`, `group:plugins`, `exec`, `browser`                                               |
| **anorak**       | `group:web`, `browser`, `read`, `write`, `exec`, `session_status`, `message`                                               |
| **art3mis**      | `group:web`, `message`, `session_status`, `browser`, `read`, `write`                                                       |
| **curator**      | `read`, `write`, `exec`, `session_status`, `group:plugins`                                                                 |
| **dito**         | `group:web`, `browser`, `read`, `write`, `exec`, `session_status`, `message`                                               |
| **ir0k**         | `group:web`, `read`, `write`, `message`, `session_status`                                                                  |
| **nolan**        | `group:web`, `read`, `write`, `exec`, `session_status`, `browser`                                                          |
| **ogden**        | `group:web`, `session_status`, `read`, `write`                                                                             |

**Tool Groups:**

- `group:web` = `web_search` + `web_fetch`
- `group:fs` = `read` + `write` + `glob` + `grep`
- `group:sessions` = session management tools
- `group:plugins` = plugin-related tools

**Tool Name Aliases**: `bash` -> `exec`, `apply-patch` -> `apply_patch`

### 5.4 Subagent Delegation Graph

```
                    oasis (orchestrator)
                   /  |  |  |  \   \  \  \
                  v   v  v  v   v   v  v  v
              aech curator art3mis ogden ir0k nolan dito anorak

        aech -----> art3mis, ir0k, curator
        art3mis --> ir0k, curator
        anorak ---> ir0k, curator
        dito -----> ir0k, curator
        ir0k -----> curator, art3mis
        nolan ----> ir0k, art3mis, aech
        ogden ----> ir0k, curator, art3mis
```

OASIS is the root orchestrator with access to all 8 specialist agents. Subagent spawning uses the ACP (Agent Control Plane) system (`src/agents/acp-spawn.ts`) with modes: `run` (fire-and-forget) or `session` (tracked).

### 5.5 Agent Workspace Structure

Each agent workspace contains:

| File                    | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `IDENTITY.md`           | Agent name, creature type, personality vibe         |
| `SOUL.md`               | Deep personality, values, communication style       |
| `DIRECTIVES.md`         | Operational rules, constraints, standard procedures |
| `MEMORY.md`             | Persistent memory across sessions                   |
| `TOOLS.md` / `tools.md` | Tool usage documentation and guidelines             |
| `USER.md`               | Information about the user (Fred)                   |
| `AGENTS.md`             | Notes about sister agents, collaboration patterns   |
| `HEARTBEAT.md`          | Periodic system status template                     |
| `models.json`           | Model preferences/overrides                         |

**Special workspaces:**

- `workspace-oasis/` also contains: `BOOT.md`, `CONTACTS.md`, `HEARTBEAT-DETAIL.md`, `dashboard/` (entire dashboard codebase)
- `workspace-curator/` contains: `MANIFEST.md`, `transcripts/` (voice transcript archive)
- `workspace-nolan/` contains: `credentials/rose-protocol-api.json`, scan reports

### 5.6 Channel Routing & Bindings

Message routing is configured via `bindings[]` in `openclaw.json`:

| Channel  | Match Criteria                  | Agent                  |
| -------- | ------------------------------- | ---------------------- |
| Telegram | Any message                     | `oasis`                |
| WhatsApp | `+19546141386` (Courtney)       | `oasis-social`         |
| WhatsApp | `+14695719955` (Monty)          | `oasis-social`         |
| WhatsApp | All other                       | `oasis`                |
| Voice    | Speaker-verified trigger phrase | Trigger-specific agent |

**Channel Configuration:**

| Channel  | Policy       | Allowed From                                                             |
| -------- | ------------ | ------------------------------------------------------------------------ |
| Telegram | DM allowlist | `7955595068` (Fred)                                                      |
| WhatsApp | DM allowlist | `+18565241725` (Fred), `+19546141386` (Courtney), `+14695719955` (Monty) |

### 5.7 Cron Jobs

Scheduled agent tasks (from cron run history):

| Job ID                         | Agent      | Schedule      | Purpose                       |
| ------------------------------ | ---------- | ------------- | ----------------------------- |
| `morning-news-brief`           | oasis/ir0k | Daily morning | News briefing                 |
| `clawlancer-scan`              | nolan      | Every 4 hours | ClawTasks marketplace scan    |
| `anorak-daily-cruise`          | anorak     | Daily         | Cruise deal monitoring        |
| `anorak-daily-recipe`          | anorak     | Daily         | Recipe suggestion             |
| `anorak-weekly-cruise`         | anorak     | Weekly        | Cruise availability deep-dive |
| `anorak-weekly-cruise-summary` | anorak     | Weekly        | Cruise summary report         |
| `anorak-weekly-meals`          | anorak     | Weekly        | Meal plan generation          |
| `aech-arb-scan`                | aech       | Periodic      | Arbitrage opportunity scan    |
| `curator-weekly-cleanup`       | curator    | Weekly        | Archive and cleanup           |
| `dito-daily-prospecting`       | dito       | Daily         | Business lead prospecting     |
| `dito-weekly-pipeline`         | dito       | Weekly        | Sales pipeline review         |
| `ogden-weekly-strategy`        | ogden      | Weekly        | Strategic advisory report     |

**Cron Delivery**: Uses `delivery.mode: "announce"` which sends the agent's text response automatically to the configured channel (typically Telegram to `7955595068`).

### 5.8 Plugin / Extension System

Extensions are loaded at runtime via **jiti** (TypeScript runtime compiler). Enabled plugins:

| Plugin       | Purpose                   |
| ------------ | ------------------------- |
| `telegram`   | Telegram bot channel      |
| `whatsapp`   | WhatsApp Web channel      |
| `voice-call` | Telnyx voice call support |

The full extension ecosystem includes 38+ extensions (Discord, Slack, Signal, iMessage, Matrix, MS Teams, Nostr, IRC, Line, etc.) but only 3 are enabled in this OASIS deployment.

**Plugin configuration** lives under `plugins.entries.{name}.config` in `openclaw.json`.

### 5.9 Skills

Installed skills with API keys:

| Skill                | API Key Source   |
| -------------------- | ---------------- |
| `nano-banana-pro`    | `GEMINI_API_KEY` |
| `openai-image-gen`   | `OPENAI_API_KEY` |
| `openai-whisper-api` | `OPENAI_API_KEY` |

### 5.10 Hooks System

The gateway exposes an HTTP hooks API for external integrations:

```
POST /hooks/wake    — Wake the gateway
POST /hooks/agent   — Dispatch a message to a specific agent
POST /hooks/        — Generic hook endpoint
```

- **Auth**: Bearer token (`OPENCLAW_HOOKS_TOKEN`)
- **Session Keys**: Allowed prefixes: `voice:`, `hook:`
- **Used By**: Audio-listener voice commands, external automation

---

## 6. Component Workflows

### 6.1 Inbound Message Flow (Telegram)

```
1. User sends Telegram message
2. Telegram bot token receives update
3. openclaw-gateway Telegram plugin processes update
4. Routing: bindings[] match channel=telegram -> agentId=oasis
5. Agent session created/resumed (session key: telegram:oasis:7955595068)
6. OASIS agent processes message with tools
7. If subagent needed: ACP spawn (mode: run|session) to specialist
8. Response delivered back to Telegram
```

### 6.2 Voice Command Flow

```
1. Microphone captures audio (PulseAudio -> PyAudio)
2. WebRTC VAD detects speech
3. Segment saved to ~/oasis-audio/inbox/
4. AssemblyAI transcribes with diarization
5. SpeechBrain identifies speakers
6. Voice command detector scans for trigger phrases
7. Verified speaker + authorized -> POST /hooks/agent
8. Gateway dispatches to target agent
9. Agent response delivered to Telegram
```

### 6.3 Inbound Voice Call Flow

```
1. Caller dials Telnyx number (+18405005883)
2. Telnyx sends webhook: call.initiated
3. voice-call extension accepts call
4. call.answered -> start transcription
5. call.transcription (Telnyx STT) -> collect speech
6. Speech complete -> response-generator invokes agent
7. Agent returns 1-2 sentence response
8. TTS pipeline: text -> PCM -> mu-law 8kHz
9. Telnyx speaks audio to caller
10. Loop until hangup
```

### 6.4 Weekly Auto-Update Flow

```
1. launchd triggers scripts/oasis-weekly-update.sh (Sunday 4 AM)
2. git fetch upstream main
3. Count commits behind
4. Pause low-priority containers
5. git merge upstream/main --no-edit
6. pnpm install && pnpm build
7. docker build (base + OASIS layer)
8. docker compose up -d --force-recreate
9. Poll gateway health (max 120s)
10. Run QA health checks
11. Send Telegram notification with summary
12. Cleanup old logs (keep last 12)
```

### 6.5 Dashboard Docker Management Flow

```
1. User opens dashboard (port 3000, basic auth)
2. Dashboard GET /api/docker/containers
3. server.js -> HTTP to docker-proxy:2375
4. docker-proxy -> Docker socket (read-only)
5. Dashboard renders container grid
6. User clicks "Restart" on a container
7. POST /api/docker/containers/:name/restart
8. server.js -> POST to docker-proxy:2375
9. Container restarts
```

### 6.6 Transcript Sync Flow

```
1. AssemblyAI transcript saved to ~/oasis-audio/done/{stem}.json
2. Speaker ID enriches transcript (pipeline_status -> "complete")
3. sync-transcripts.py detects new/updated JSON
4. Readiness gate: check pipeline_status + unidentified speaker grace
5. Convert to curator dashboard format
6. Save to ~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/
7. Create .synced marker
8. Dashboard reads curator transcripts for display
```

---

## 7. API / Interface Contracts

### 7.1 Gateway WebSocket API

**Connection**: `ws://{host}:18789`

**Auth Frame**: Token or password in initial `connect` message.

**Request-Response Pattern**:

```json
// Request
{"id": "uuid", "method": "chat.send", "params": {"message": "hello"}}

// Response
{"id": "uuid", "result": {...}}
```

**Core Methods:**

| Category      | Methods                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Chat**      | `chat.history`, `chat.send`, `chat.abort`                                                                                      |
| **Config**    | `config.get`, `config.set`, `config.apply`, `config.patch`, `config.schema`                                                    |
| **Status**    | `health`, `status`, `doctor.memory.status`, `logs.tail`                                                                        |
| **Channels**  | `channels.status`, `channels.logout`                                                                                           |
| **Agents**    | `agents.list`, `agents.create`, `agents.update`, `agents.delete`, `agents.files.*`, `agent.identity.get`                       |
| **Sessions**  | `sessions.list`, `sessions.preview`, `sessions.patch`, `sessions.reset`, `sessions.delete`, `sessions.compact`                 |
| **Cron**      | `cron.list`, `cron.status`, `cron.add`, `cron.update`, `cron.remove`, `cron.run`, `cron.runs`                                  |
| **Skills**    | `skills.status`, `skills.bins`, `skills.install`, `skills.update`                                                              |
| **Approvals** | `exec.approvals.get`, `exec.approvals.set`, `exec.approval.request`, `exec.approval.waitDecision`, `exec.approval.resolve`     |
| **Devices**   | `device.pair.*`, `device.token.*`                                                                                              |
| **Nodes**     | `node.list`, `node.describe`, `node.invoke`, `node.invoke.result`, `node.event`, `node.pair.*`                                 |
| **TTS**       | `tts.status`, `tts.providers`, `tts.enable`, `tts.disable`, `tts.convert`, `tts.setProvider`                                   |
| **Misc**      | `wake`, `update.run`, `voicewake.get`, `voicewake.set`, `send`, `agent`, `agent.wait`, `browser.request`, `wizard.*`, `talk.*` |

**Events (Subscriptions):**
`connect.challenge`, `agent`, `chat`, `presence`, `tick`, `talk.mode`, `shutdown`, `health`, `heartbeat`, `cron`, `node.pair.*`, `device.pair.*`, `voicewake.changed`, `exec.approval.*`, `update-available`

### 7.2 Gateway HTTP Endpoints

| Method | Path                                 | Auth               | Purpose                          |
| ------ | ------------------------------------ | ------------------ | -------------------------------- |
| GET    | `/`                                  | None               | Control UI SPA                   |
| GET    | `/__openclaw/control-ui-config.json` | None               | Bootstrap configuration          |
| GET    | `/avatar/{agentId}`                  | None               | Agent avatar proxy               |
| POST   | `/hooks/wake`                        | Bearer token       | Wake gateway                     |
| POST   | `/hooks/agent`                       | Bearer token       | Dispatch agent message           |
| POST   | `/v1/chat/completions`               | Token              | OpenAI-compatible API (optional) |
| POST   | `/v1/responses`                      | Token              | OpenResponses API (optional)     |
| POST   | `/slack/events/`                     | Slack verification | Slack webhook                    |
| POST   | `/tools/invoke-http`                 | Token              | HTTP tool invocation             |
| WS     | `/canvas.ws`                         | Token              | Canvas WebSocket                 |

### 7.3 Audio-Listener HTTP Endpoints

| Method | Path               | Purpose                           |
| ------ | ------------------ | --------------------------------- |
| GET    | `/health`          | Basic health status               |
| GET    | `/health/detailed` | Full pipeline metrics             |
| POST   | `/label-speaker`   | Label a speaker in a transcript   |
| POST   | `/reidentify`      | Trigger speaker re-identification |

### 7.4 Dashboard API

| Method | Path                                   | Auth       | Purpose                   |
| ------ | -------------------------------------- | ---------- | ------------------------- |
| GET    | `/api/health`                          | Basic Auth | Health check              |
| GET    | `/api/docker/containers`               | Basic Auth | Container list with stats |
| POST   | `/api/docker/containers/:name/stop`    | Basic Auth | Stop container            |
| POST   | `/api/docker/containers/:name/start`   | Basic Auth | Start container           |
| POST   | `/api/docker/containers/:name/restart` | Basic Auth | Restart container         |
| POST   | `/api/docker/restart-all`              | Basic Auth | Restart all containers    |
| POST   | `/api/docker/rebuild`                  | Basic Auth | Trigger rebuild script    |

### 7.5 Voice Command Dispatch Contract

```json
POST http://oasis:18789/hooks/agent
Content-Type: application/json
Authorization: Bearer {OPENCLAW_GATEWAY_TOKEN}

{
  "message": "turn on the lights",
  "name": "Fred (Voice)",
  "agentId": "oasis",
  "channel": "telegram",
  "to": "7955595068",
  "deliver": true,
  "sessionKey": "voice:oasis:fred"
}
```

### 7.6 Transcript Data Formats

**AssemblyAI Output** (internal, at `/audio/done/{stem}.json`):

```json
{
  "file": "recording_YYYYMMDD_HHMMSS.wav",
  "language": "en",
  "segments": [
    {
      "start": 0.5,
      "end": 2.1,
      "text": "hello there",
      "speaker": "SPEAKER_00",
      "confidence": 0.95,
      "words": [
        { "text": "hello", "start": 0.5, "end": 1.0, "confidence": 0.98, "speaker": "SPEAKER_00" }
      ]
    }
  ],
  "num_speakers": 1,
  "model": "assemblyai-universal-2",
  "diarization": true,
  "pipeline_status": "complete",
  "speaker_identification": {
    "identified": {
      "SPEAKER_00": { "name": "fred", "distance": 0.12, "method": "multi-segment-avg" }
    },
    "unidentified": [],
    "profiles_checked": 3,
    "timestamp": "ISO"
  },
  "assemblyai": {
    "transcript_id": "...",
    "audio_duration": 5.2,
    "confidence": 0.94,
    "cost_usd": 0.0024,
    "language_code": "en"
  }
}
```

**Curator Dashboard Format** (at `~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/`):

```json
{
  "timestamp": "ISO",
  "duration": 5,
  "transcript": "hello there how are you",
  "audioPath": "recording_YYYYMMDD_HHMMSS.wav",
  "speakers": [{"id": "SPEAKER_00", "name": "fred", "utterances": [...]}],
  "numSpeakers": 1,
  "utterances": [{"speaker": "fred", "text": "...", "start": 0.5, "end": 2.1}],
  "source": "voice-passive",
  "model": "assemblyai-universal-2",
  "pipeline_status": "complete",
  "speaker_identification": {...},
  "assemblyai": {...}
}
```

### 7.7 TODO System Contract

File: `~/.openclaw/dashboard-todos.json`

```json
[
  {
    "id": "uuid",
    "title": "Task title",
    "description": "Task description",
    "status": "pending|planning|awaiting_approval|executing|completed|failed",
    "priority": "low|medium|high",
    "context": "optional context",
    "created_at": "ISO",
    "completed_at": "ISO|null"
  }
]
```

---

## 8. Security Architecture

### 8.1 Authentication Layers

| Surface                | Mechanism                                                  |
| ---------------------- | ---------------------------------------------------------- |
| **Gateway WebSocket**  | Token (Ed25519 device auth) or password                    |
| **Gateway HTTP Hooks** | Bearer token (`OPENCLAW_GATEWAY_TOKEN`)                    |
| **Dashboard**          | HTTP Basic Auth (`OPENCLAW_DASHBOARD_USERNAME`/`PASSWORD`) |
| **Telegram**           | Bot token + allowlist (`allowFrom`)                        |
| **WhatsApp**           | DM allowlist (phone numbers)                               |
| **Docker Socket**      | Proxied with minimal API surface                           |

### 8.2 Network Security

- Gateway binds to LAN (`0.0.0.0:18789`) with trusted proxy list (`192.168.65.0/24`, `172.17.0.0/16`, `127.0.0.0/8`)
- Dashboard binds to all interfaces (`0.0.0.0:3000`)
- Audio-listener binds to loopback only (`127.0.0.1:9001`)
- Bridge port loopback-only (`127.0.0.1:18790`)
- Docker socket proxy restricts to container list/inspect/control only
- Tailscale configured but mode set to `off`

### 8.3 Container Security

- All containers: `cap_drop: [ALL]`, `security_opt: no-new-privileges:true`
- Non-root users: gateway (`node`), dashboard (`1000:1000`), CLI (`node`)
- Read-only source mounts
- Resource limits (memory, CPU, PIDs) on all services
- OOM priority set for audio-listener (killed first under pressure)

### 8.4 Secret Management

- All secrets in `.env` at repo root
- `.env` is gitignored
- Secrets injected via `env_file: .env` in docker-compose.yml
- Environment variable substitution (`${VAR}`) used in config
- Gateway nodes deny sensitive commands: `camera.snap`, `camera.clip`, `screen.record`, `calendar.add`, `contacts.add`, `reminders.add`

---

## 9. Operational Runbooks

### 9.1 Startup

```bash
# Start all services
scripts/oasis-up.sh

# Or directly
docker compose up -d

# Start CLI container (on-demand)
docker compose --profile cli up -d openclaw-cli
```

### 9.2 Health Check

```bash
# Comprehensive health check with auto-healing
scripts/oasis-health.sh

# Read-only check
scripts/oasis-health.sh --check
```

### 9.3 Log Access

```bash
# Docker container logs
docker compose logs -f oasis              # Gateway
docker compose logs -f oasis-dashboard    # Dashboard
docker compose logs -f audio-listener     # Audio pipeline
docker compose logs --since 1h oasis      # Last hour

# Host system logs
tail -f ~/.openclaw/logs/health-alert.log
tail -f ~/.openclaw/logs/transcript-sync.log

# macOS unified logs
scripts/clawlog.sh -f
scripts/clawlog.sh -c gateway
```

### 9.4 Speaker Management

```bash
# Enroll a new speaker interactively
python3 audio-listener/enroll_speaker.py

# Label a speaker from a transcript
python3 scripts/voice/label_speaker.py <transcript> SPEAKER_00 fred

# Re-identify all transcripts
python3 scripts/voice/reidentify_speakers.py --all

# Review unknown candidates
python3 scripts/voice/review_candidates.py
```

### 9.5 Weekly Update

```bash
# Dry run (check for updates)
scripts/oasis-weekly-update.sh --dry-run

# Full update
scripts/oasis-weekly-update.sh
```

### 9.6 Key File Locations

| Path                                               | Purpose                                    |
| -------------------------------------------------- | ------------------------------------------ |
| `.env`                                             | All secrets and environment variables      |
| `~/.openclaw/openclaw.json`                        | Central agent/channel/plugin configuration |
| `~/.openclaw/workspace-{agentId}/`                 | Agent workspaces                           |
| `~/.openclaw/agents/{agentId}/sessions/`           | Agent session logs (JSONL)                 |
| `~/.openclaw/cron/runs/`                           | Cron job execution logs                    |
| `~/.openclaw/logs/`                                | System logs (health, sync, updates)        |
| `~/.openclaw/voice-profiles/`                      | Enrolled speaker profiles                  |
| `~/.openclaw/unknown-speakers/`                    | Unknown speaker candidate data             |
| `~/.openclaw/dashboard-todos.json`                 | TODO items                                 |
| `~/oasis-audio/inbox/`                             | WAV files awaiting transcription           |
| `~/oasis-audio/done/`                              | Completed transcripts + .synced markers    |
| `~/.openclaw/workspace-curator/transcripts/voice/` | Dashboard-format transcripts               |
| `~/.openclaw/workspace-oasis/dashboard/`           | Dashboard codebase                         |
| `docker-compose.yml`                               | Container orchestration                    |
| `Dockerfile`                                       | Base OpenClaw image                        |
| `Dockerfile.oasis`                                 | OASIS customization layer                  |
| `audio-listener/`                                  | Audio pipeline source                      |
| `extensions/voice-call/`                           | Voice call extension source                |
| `scripts/oasis-weekly-update.sh`                   | Auto-update script                         |
| `scripts/oasis-health.sh`                          | Health check script                        |
| `scripts/voice/sync-transcripts.py`                | Transcript sync bridge                     |

### 9.7 launchd Services

| Label                               | Schedule     | Purpose                     |
| ----------------------------------- | ------------ | --------------------------- |
| `com.openclaw.oasis`                | Always       | Gateway startup             |
| `com.openclaw.weekly-update`        | Sunday 4 AM  | Upstream sync + rebuild     |
| `com.openclaw.backup`               | Daily 3 AM   | Backup verification         |
| `com.oasis.health-alert`            | Every 10 min | Container health monitoring |
| `com.oasis.transcript-sync`         | Continuous   | WhisperX -> curator sync    |
| `com.oasis.nightly-import`          | Daily 1 AM   | Audio import pipeline       |
| `com.oasis.plaud-sync`              | Every 5 min  | Plaud sync                  |
| `org.pulseaudio`                    | Always       | PulseAudio audio bridge     |
| `ai.openclaw.audio-import`          | Always       | Audio import service        |
| `ai.openclaw.voice-listener`        | Always       | Voice listener service      |
| `com.openclaw.claude-todo-listener` | Always       | Approval listener           |

---

_Document generated via static analysis of the OpenClaw OASIS repository. Reflects the state of the codebase as of 2026-02-28._
