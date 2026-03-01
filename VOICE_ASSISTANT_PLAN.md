# Always-On Voice Assistant Implementation Plan for OASIS

**Date:** 2026-02-16
**Status:** Planning Phase
**Timeline:** 6 weeks to production-ready system
**Estimated Cost:** ~$50/month operational + $100 one-time hardware

---

## Table of Contents

1. [Context & Requirements](#context--requirements)
2. [Architecture Overview](#architecture-overview)
3. [Component Details](#component-details)
4. [Implementation Sequence](#implementation-sequence)
5. [Privacy & Control Features](#privacy--control-features)
6. [Testing & Validation](#testing--validation)
7. [Performance Expectations](#performance-expectations)
8. [Cost Analysis](#cost-analysis)
9. [Monitoring & Alerting](#monitoring--alerting)
10. [Future Enhancements](#future-enhancements)

---

## Context & Requirements

### Goal

Transform OASIS into an always-on voice assistant that listens through a plugged-in speaker/microphone in your office.

### Requirements

- ✅ **Continuously transcribe all conversations** (including other people speaking)
- ✅ **Only accept commands from Fred** after learning his voice
- ✅ **Respond only when addressed as "oasis"** by name
- ✅ **Log everything for curator agent** to analyze
- ✅ **Track multiple speakers** (Fred, Courtney, Monty, others)
- ✅ **Maintain privacy controls** (pause, delete, exclude time windows)

### Existing Infrastructure

**Swabble** - macOS 26+ wake-word daemon with Speech.framework

- Local-only speech recognition
- Microphone capture via AVAudioEngine
- Wake word detection ("claude", "clawd")
- Transcript logging capabilities

**OpenClaw Voice Systems**

- Voice-call extension (Telnyx-based telephony)
- OpenAI Realtime STT (streaming transcription)
- Media understanding (Whisper, Deepgram integration)
- macOS app with voice settings UI

**Curator Agent**

- Universal archivist / record keeper
- Already receives Plaud device transcripts
- Workspace: `~/.openclaw/workspace-curator/`

---

## Architecture Overview

### Key Architectural Decision

**Docker containers on macOS cannot access host audio devices** natively. CoreAudio/AVAudioEngine requires direct hardware access that Docker isolates. Therefore, audio capture **must run on the macOS host**, not in a container.

### Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    macOS Host (Mac Mini)                     │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Swabble - Always-On Passive Transcription Mode         │ │
│  │  • Continuous microphone capture (AVAudioEngine)       │ │
│  │  • On-device transcription (Speech.framework)          │ │
│  │  • Write transcripts + audio chunks to shared volume   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Shared Volume: ~/.openclaw/voice-transcripts/          │ │
│  │  • raw/YYYY-MM-DD-HH-MM-SS.json (transcripts)          │ │
│  │  • audio/chunk-*.m4a (30-second audio chunks)          │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Docker Containers (docker-compose)              │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ voice-processor (New Service)                          │ │
│  │  1. Watch for new transcript files                     │ │
│  │  2. Send audio to Deepgram for speaker diarization    │ │
│  │  3. Extract speaker embeddings                        │ │
│  │  4. Match against Fred/Courtney/Monty profiles        │ │
│  │  5. Detect "oasis" wake word from Fred only           │ │
│  │  6. Route commands → gateway                          │ │
│  │  7. Forward ALL transcripts → curator                 │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ openclaw-gateway (Existing)                            │ │
│  │  • Receives voice commands from voice-processor        │ │
│  │  • Routes to OASIS agent for execution                │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ curator agent (Existing)                               │ │
│  │  • Receives all voice transcripts                      │ │
│  │  • Stores in workspace-curator/transcripts/voice/      │ │
│  │  • Analyzes conversations, extracts insights           │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Audio Capture (Host)
  ├─> Microphone → AVAudioEngine → Speech.framework
  └─> Continuous transcription (no wake word requirement)

Transcript Generation (Host - Swabble)
  ├─> Write JSON to ~/.openclaw/voice-transcripts/raw/
  └─> Include audio chunk for diarization

File Watcher (Container - voice-processor)
  ├─> Detect new transcript file
  └─> Read transcript + audio path

Speaker Diarization (Container → Cloud)
  ├─> Send audio to Deepgram
  ├─> Receive word-level speaker labels
  └─> Group into speaker-tagged utterances

Speaker Recognition (Container)
  ├─> Extract embeddings for each speaker
  ├─> Match against enrolled profiles
  └─> Tag utterances: "fred", "courtney", "unknown", etc.

Command Detection (Container)
  ├─> Scan Fred's utterances for "oasis <command>"
  └─> Extract command if found

Command Routing (Container → Gateway)
  └─> Forward to gateway → OASIS agent executes

Passive Logging (Container → Curator)
  ├─> Write ALL transcripts to curator workspace
  └─> Curator analyzes conversations asynchronously
```

---

## Component Details

### 1. Swabble Extensions (macOS Host)

**Location:** `/Users/oasis/openclaw/Swabble/`

**Modifications Needed:**

- Add `--mode passive` flag to `serve` command
- Disable wake-word gating when in passive mode
- Continuously transcribe ALL audio (not just post-wake)
- Write timestamped JSON files with transcripts
- Include raw audio chunks for downstream diarization
- Support speaker change detection hints

**Critical Files to Modify:**

- `Swabble/Sources/swabble/Commands/ServeCommand.swift` - Add passive mode flag
- `Swabble/Sources/SwabbleCore/Speech/SpeechPipeline.swift` - Continuous JSON output

**New Config** (`~/.config/swabble/config.json`):

```json
{
  "audio": {
    "deviceName": "",
    "deviceIndex": -1,
    "sampleRate": 16000,
    "channels": 1
  },
  "wake": {
    "enabled": false,
    "word": "clawd",
    "aliases": ["claude"]
  },
  "passive": {
    "enabled": true,
    "outputDir": "/Users/oasis/.openclaw/voice-transcripts/raw",
    "chunkDurationSec": 30,
    "includeAudioData": true,
    "audioFormat": "m4a"
  },
  "logging": {
    "level": "info",
    "format": "text"
  },
  "transcripts": {
    "enabled": true,
    "maxEntries": 50
  },
  "speech": {
    "localeIdentifier": "en_US",
    "etiquetteReplacements": false
  }
}
```

**Output Format:**

```json
{
  "timestamp": "2026-02-16T15:30:00Z",
  "duration": 30.5,
  "transcript": "full text of what was said",
  "isFinal": true,
  "audioPath": "/Users/oasis/.openclaw/voice-transcripts/raw/audio/chunk-123.m4a",
  "deviceName": "Blue Yeti Microphone"
}
```

**Launchd Service** (`~/Library/LaunchAgents/ai.openclaw.swabble.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.openclaw.swabble</string>

  <key>ProgramArguments</key>
  <array>
    <string>/Users/oasis/openclaw/Swabble/.build/release/swabble</string>
    <string>serve</string>
    <string>--mode</string>
    <string>passive</string>
    <string>--config</string>
    <string>/Users/oasis/.config/swabble/config.json</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/oasis/.openclaw/logs/swabble-stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/oasis/.openclaw/logs/swabble-stderr.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/Users/oasis</string>
  </dict>
</dict>
</plist>
```

**Management Commands:**

```bash
# Load and start
launchctl load ~/Library/LaunchAgents/ai.openclaw.swabble.plist

# Stop and unload
launchctl unload ~/Library/LaunchAgents/ai.openclaw.swabble.plist

# Check status
launchctl list | grep swabble

# View logs
tail -f ~/.openclaw/logs/swabble-stdout.log
tail -f ~/.openclaw/logs/swabble-stderr.log
```

---

### 2. Voice Processor Service (New Docker Container)

**Location:** Create new `/Users/oasis/openclaw/services/voice-processor/`

**Tech Stack:**

- Node.js/TypeScript (consistent with OpenClaw codebase)
- chokidar for file watching
- @deepgram/sdk for speaker diarization
- SpeechBrain embeddings (via Python subprocess)
- WebSocket connection to gateway

**Directory Structure:**

```
services/voice-processor/
├── src/
│   ├── index.ts              # Main entry point
│   ├── watcher.ts            # File system watcher
│   ├── diarization.ts        # Deepgram API integration
│   ├── speaker-recognition.ts # Voice matching with embeddings
│   ├── command-router.ts     # Gateway integration
│   ├── curator-forwarder.ts  # Curator integration
│   ├── enrollment.ts         # Voice profile management
│   └── types.ts              # TypeScript types
├── python/
│   └── extract_embedding.py  # SpeechBrain embedding extractor
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

**Key Modules:**

**watcher.ts:**

```typescript
import chokidar from "chokidar";

export class TranscriptWatcher {
  private watcher: chokidar.FSWatcher;

  constructor(private dir: string) {
    this.watcher = chokidar.watch(`${dir}/*.json`, {
      persistent: true,
      ignoreInitial: false,
    });
  }

  onTranscript(handler: (filePath: string) => Promise<void>): void {
    this.watcher.on("add", async (filePath) => {
      await handler(filePath);
    });
  }
}
```

**diarization.ts:**

```typescript
import { createClient } from "@deepgram/sdk";

export async function diarizeAudio(audioPath: string): Promise<DiarizedTranscript> {
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  const { result } = await deepgram.listen.prerecorded.transcribeFile(fs.readFileSync(audioPath), {
    model: "nova-3",
    diarize: true,
    diarize_version: "latest",
    language: "en",
    punctuate: true,
    utterances: true,
    smart_format: true,
  });

  return parseDiarization(result);
}
```

**speaker-recognition.ts:**

```typescript
import { spawn } from "child_process";

export async function extractEmbedding(audioPath: string): Promise<number[]> {
  // Call Python subprocess with SpeechBrain
  const python = spawn("python3", ["python/extract_embedding.py", audioPath]);

  return new Promise((resolve, reject) => {
    let output = "";
    python.stdout.on("data", (data) => {
      output += data;
    });
    python.on("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(output));
      } else {
        reject(new Error(`Embedding extraction failed: ${code}`));
      }
    });
  });
}

export function matchSpeaker(embedding: number[], profiles: VoiceProfile[]): string | null {
  for (const profile of profiles) {
    for (const enrolledEmbedding of profile.embeddings) {
      const similarity = cosineSimilarity(embedding, enrolledEmbedding);
      if (similarity > profile.threshold) {
        return profile.name;
      }
    }
  }
  return null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magA * magB);
}
```

**command-router.ts:**

```typescript
export function detectCommand(utterance: Utterance, speaker: string): Command | null {
  // Only accept commands from Fred
  if (speaker !== "fred") return null;

  const wakeWords = ["oasis", "ohasis", "oh asis"];
  const transcript = utterance.transcript.toLowerCase();

  for (const wake of wakeWords) {
    const idx = transcript.indexOf(wake);
    if (idx !== -1) {
      const command = transcript.substring(idx + wake.length).trim();
      if (command.length > 0) {
        return {
          speaker: "fred",
          wakeWord: wake,
          command,
          timestamp: utterance.timestamp,
          confidence: utterance.confidence,
        };
      }
    }
  }
  return null;
}

export async function routeCommand(command: Command): Promise<void> {
  await fetch("http://oasis:18789/api/voice-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "voice",
      from: "fred",
      text: command.command,
      metadata: {
        wakeWord: command.wakeWord,
        timestamp: command.timestamp,
        confidence: command.confidence,
      },
    }),
  });
}
```

**curator-forwarder.ts:**

```typescript
export async function forwardToCurator(transcript: DiarizedTranscript): Promise<void> {
  const outputPath = generateCuratorPath(transcript.timestamp);

  const curatorFormat = {
    source: "voice-passive",
    timestamp: transcript.timestamp,
    duration: transcript.duration,
    speakers: transcript.speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.name || null,
      utterances: speaker.utterances.map((u) => ({
        text: u.text,
        start: u.start,
        end: u.end,
        confidence: u.confidence,
      })),
    })),
    environment: {
      deviceName: transcript.deviceName,
      location: "home_office",
    },
  };

  await fs.writeFile(outputPath, JSON.stringify(curatorFormat, null, 2));
}

function generateCuratorPath(timestamp: string): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const time = d.toISOString().replace(/[:.]/g, "-");

  const dir = `/config/workspace-curator/transcripts/voice/${year}/${month}/${day}`;
  fs.mkdirSync(dir, { recursive: true });

  return `${dir}/${time}.json`;
}
```

**Python Embedding Extractor** (`python/extract_embedding.py`):

```python
#!/usr/bin/env python3
import sys
import json
import torch
from speechbrain.inference.speaker import SpeakerRecognition

# Load SpeechBrain ECAPA-TDNN model
model = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="tmp/spkrec-ecapa-voxceleb"
)

def extract_embedding(audio_path):
    # Extract embedding
    embedding = model.encode_batch(model.load_audio(audio_path))

    # Convert to list
    embedding_list = embedding.squeeze().tolist()

    return embedding_list

if __name__ == "__main__":
    audio_path = sys.argv[1]
    embedding = extract_embedding(audio_path)
    print(json.dumps(embedding))
```

**Docker Compose Addition:**

```yaml
voice-processor:
  build:
    context: ./services/voice-processor
  container_name: voice-processor
  networks:
    - openclaw
  environment:
    DEEPGRAM_API_KEY: ${DEEPGRAM_API_KEY}
    GATEWAY_URL: ws://oasis:18789
    VOICE_PROFILES_DIR: /config/voice-profiles
    TRANSCRIPTS_DIR: /config/voice-transcripts
  volumes:
    - ${OPENCLAW_CONFIG_DIR}/voice-transcripts:/config/voice-transcripts
    - ${OPENCLAW_CONFIG_DIR}/voice-profiles:/config/voice-profiles
    - ${OPENCLAW_CONFIG_DIR}/workspace-curator:/config/workspace-curator
    - ${OPENCLAW_CONFIG_DIR}/.secrets/voice-processor.env:/run/secrets/voice-processor.env:ro
    - ./scripts/docker-secrets-entrypoint.sh:/usr/local/bin/docker-secrets-entrypoint.sh:ro
  entrypoint: ["docker-secrets-entrypoint.sh"]
  command: ["node", "dist/index.js", "serve"]
  restart: unless-stopped
  depends_on:
    openclaw-gateway:
      condition: service_healthy
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
  deploy:
    resources:
      limits:
        memory: 1g
        cpus: "1.0"
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
```

---

### 3. Speaker Recognition System

**Voice Enrollment Process:**

Create CLI command: `openclaw voice enroll <speaker-name>`

1. Records 30-60 seconds of speech samples
2. Extracts multiple embeddings using SpeechBrain ECAPA-TDNN model
3. Stores profile at `~/.openclaw/voice-profiles/<speaker-name>.json`

**Profile Format:**

```json
{
  "name": "fred",
  "enrolledAt": "2026-02-16T15:00:00Z",
  "embeddings": [
    [0.1234, 0.5678, -0.2345, ...],  // 192-dimensional vectors
    [0.2345, 0.6789, -0.1234, ...],
    [0.3456, 0.7890, -0.0123, ...]
  ],
  "threshold": 0.75,  // Cosine similarity threshold
  "samples": [
    "/Users/oasis/.openclaw/voice-profiles/fred/sample-1.m4a",
    "/Users/oasis/.openclaw/voice-profiles/fred/sample-2.m4a",
    "/Users/oasis/.openclaw/voice-profiles/fred/sample-3.m4a"
  ]
}
```

**Recognition Runtime:**

1. Extract embedding from incoming utterance audio
2. Compute cosine similarity against all enrolled embeddings
3. Accept if similarity > threshold (typically 0.75-0.80)
4. Return speaker name or `null` if no match

**SpeechBrain ECAPA-TDNN Model:**

- Model: `speechbrain/spkrec-ecapa-voxceleb` from HuggingFace
- Output: 192-dimensional speaker embedding
- Free, open source, runs locally
- ~500ms latency per utterance on Mac Mini

**Enrollment Script:**

```bash
#!/bin/bash
# openclaw voice enroll fred

SPEAKER_NAME="$1"
PROFILE_DIR="$HOME/.openclaw/voice-profiles/$SPEAKER_NAME"
mkdir -p "$PROFILE_DIR"

echo "Enrolling speaker: $SPEAKER_NAME"
echo "Please speak naturally for 30 seconds..."

# Record 3 samples
for i in {1..3}; do
  echo "Sample $i/3 - Speak now..."
  sox -d "$PROFILE_DIR/sample-$i.m4a" trim 0 10
  echo "Sample $i recorded."
  sleep 2
done

# Extract embeddings and create profile
node dist/cli.js voice create-profile "$SPEAKER_NAME" "$PROFILE_DIR"

echo "Enrollment complete!"
```

---

### 4. Deepgram Speaker Diarization

**API Integration:**

```typescript
// POST https://api.deepgram.com/v1/listen
const response = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
  model: "nova-3",
  diarize: true,
  diarize_version: "latest",
  language: "en",
  punctuate: true,
  utterances: true,
  smart_format: true,
});
```

**Response Format:**

```json
{
  "results": {
    "channels": [
      {
        "alternatives": [
          {
            "transcript": "hello there world is great",
            "words": [
              { "word": "hello", "start": 0.5, "end": 0.9, "speaker": 0 },
              { "word": "there", "start": 1.0, "end": 1.3, "speaker": 0 },
              { "word": "world", "start": 2.0, "end": 2.4, "speaker": 1 },
              { "word": "is", "start": 2.5, "end": 2.7, "speaker": 1 },
              { "word": "great", "start": 2.8, "end": 3.2, "speaker": 1 }
            ]
          }
        ]
      }
    ],
    "utterances": [
      {
        "speaker": 0,
        "transcript": "hello there",
        "start": 0.5,
        "end": 1.3,
        "confidence": 0.95
      },
      {
        "speaker": 1,
        "transcript": "world is great",
        "start": 2.0,
        "end": 3.2,
        "confidence": 0.92
      }
    ]
  }
}
```

**Processing Pipeline:**

1. Receive 30-second audio chunk from Swabble
2. Send to Deepgram for diarization
3. Receive word-level speaker labels (`speaker: 0`, `speaker: 1`, etc.)
4. Group by speaker into utterances
5. Extract embedding for each utterance
6. Match embeddings against enrolled profiles (Fred, Courtney, Monty)
7. Tag each utterance with identified speaker name

**Deepgram Modification:**

Extend existing `src/media-understanding/providers/deepgram/audio.ts`:

```typescript
export async function transcribeDeepgramAudio(
  params: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
  // ... existing code ...

  const url = new URL(`${baseUrl}/listen`);
  url.searchParams.set("model", model);

  // Add diarization parameters
  if (params.diarize) {
    url.searchParams.set("diarize", "true");
    url.searchParams.set("diarize_version", "latest");
    url.searchParams.set("utterances", "true");
  }

  // ... rest of existing code ...
}
```

**Cost Calculation:**

- Rate: $0.0043 per minute
- Daily usage: Estimate 6 hours of conversation = 360 minutes
- Monthly: 360 min/day × 30 days = 10,800 minutes
- **Cost: $0.0043 × 10,800 = $46.44/month**

---

### 5. Wake Word Detection + Command Routing

**Detection Logic:**

```typescript
function detectCommand(utterance: Utterance, speakerProfile: SpeakerProfile): Command | null {
  // Only accept commands from Fred
  if (speakerProfile.name !== "fred") {
    return null;
  }

  // Check for wake word "oasis" with phonetic variants
  const wakeWords = ["oasis", "ohasis", "oh asis", "oases"];
  const transcript = utterance.transcript.toLowerCase();

  for (const wakeWord of wakeWords) {
    const wakeIndex = transcript.indexOf(wakeWord);
    if (wakeIndex !== -1) {
      // Extract command after wake word
      const commandText = transcript.substring(wakeIndex + wakeWord.length).trim();

      if (commandText.length > 0) {
        return {
          speaker: "fred",
          wakeWord,
          command: commandText,
          timestamp: utterance.timestamp,
          confidence: utterance.confidence,
        };
      }
    }
  }

  return null;
}
```

**Command Routing to Gateway:**

```typescript
async function routeCommand(command: Command): Promise<void> {
  // Send to gateway via HTTP
  const response = await fetch("http://oasis:18789/api/voice-command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      channel: "voice",
      from: "fred",
      text: command.command,
      metadata: {
        wakeWord: command.wakeWord,
        timestamp: command.timestamp,
        confidence: command.confidence,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  console.log(`Command routed: "${command.command}"`);
}
```

**Gateway API Endpoint** (to be added to `src/gateway/`):

```typescript
// src/gateway/voice-command-handler.ts
export async function handleVoiceCommand(req: Request, res: Response) {
  const { channel, from, text, metadata } = req.body;

  // Validate request
  if (channel !== "voice" || from !== "fred") {
    return res.status(403).json({ error: "Unauthorized voice command" });
  }

  // Route to OASIS agent
  await routeMessage({
    agentId: "oasis",
    channel: "voice",
    from: "fred",
    text,
    metadata,
  });

  res.status(200).json({ success: true });
}
```

---

### 6. Curator Integration

**All transcripts** (not just Fred's commands) get written to curator workspace for analysis.

**Curator Transcript Format:**

```json
{
  "source": "voice-passive",
  "timestamp": "2026-02-16T15:30:00Z",
  "duration": 30.5,
  "speakers": [
    {
      "id": "speaker_0",
      "name": "fred",
      "utterances": [
        {
          "text": "I need to remember to call mom tomorrow",
          "start": 0.5,
          "end": 3.2,
          "confidence": 0.95
        },
        {
          "text": "oasis add that to my tasks",
          "start": 4.0,
          "end": 5.5,
          "confidence": 0.98
        }
      ]
    },
    {
      "id": "speaker_1",
      "name": "courtney",
      "utterances": [
        {
          "text": "Don't forget your doctor appointment too",
          "start": 6.0,
          "end": 8.5,
          "confidence": 0.92
        }
      ]
    },
    {
      "id": "speaker_2",
      "name": null,
      "utterances": [
        {
          "text": "Background conversation unintelligible",
          "start": 10.0,
          "end": 12.0,
          "confidence": 0.65
        }
      ]
    }
  ],
  "environment": {
    "deviceName": "Blue Yeti Microphone",
    "location": "home_office"
  }
}
```

**Storage Path:**

```
~/.openclaw/workspace-curator/transcripts/voice/
  ├── 2026/
  │   ├── 02/
  │   │   ├── 16/
  │   │   │   ├── 2026-02-16T15-30-00-000Z.json
  │   │   │   ├── 2026-02-16T15-30-30-000Z.json
  │   │   │   └── 2026-02-16T15-31-00-000Z.json
```

**Curator Analysis Capabilities:**

Curator can then:

- Extract mentioned tasks, reminders, commitments
- Track conversation topics over time
- Identify patterns in speech (morning routines, work habits)
- Cross-reference with calendar events
- Generate daily/weekly conversation summaries
- Detect emotional context from conversation tone
- Flag important information for review

---

## Implementation Sequence

### Week 1: Swabble Extensions + Infrastructure

**Tasks:**

1. Extend Swabble `ServeCommand.swift` with `--mode passive` flag
2. Modify `SpeechPipeline.swift` for continuous transcription
3. Implement JSON file output with timestamps
4. Add audio chunk writing to `.m4a` format
5. Create directory structure for transcripts
6. Set up launchd service plist
7. Test 24-hour continuous operation

**Deliverables:**

- ✅ Modified Swabble binary with passive mode
- ✅ Config file template (`~/.config/swabble/config.json`)
- ✅ Launchd plist for auto-start
- ✅ 24-hour stability test results

**Verification:**

```bash
# Build Swabble
cd ~/openclaw/Swabble
swift build -c release

# Test passive mode
.build/release/swabble serve --mode passive --config ~/.config/swabble/config.json

# Check output
ls ~/.openclaw/voice-transcripts/raw/
cat ~/.openclaw/voice-transcripts/raw/2026-02-16T15-30-00.json
```

---

### Week 2: Speaker Diarization (Deepgram)

**Tasks:**

1. Create `services/voice-processor/` directory structure
2. Implement file watcher with chokidar
3. Integrate Deepgram SDK with diarization parameters
4. Parse diarization response (word-level speaker labels)
5. Group words into speaker-tagged utterances
6. Test diarization accuracy with 2-3 speaker samples
7. Add voice-processor to `docker-compose.yml`

**Deliverables:**

- ✅ voice-processor service skeleton (TypeScript)
- ✅ Deepgram integration with diarization
- ✅ Diarization accuracy report (target: >85%)
- ✅ Docker service configuration

**Verification:**

```bash
# Build service
cd ~/openclaw/services/voice-processor
npm install
npm run build

# Test diarization
npm run test:diarization

# Start service
docker compose up voice-processor
```

---

### Week 3: Speaker Recognition (Voice Enrollment)

**Tasks:**

1. Implement `openclaw voice enroll <name>` CLI command
2. Create Python script for SpeechBrain embedding extraction
3. Implement voice profile storage format
4. Implement cosine similarity matching algorithm
5. Enroll Fred, Courtney, Monty voice profiles
6. Test recognition accuracy (100+ samples)
7. Tune similarity threshold for <1% false accept rate

**Deliverables:**

- ✅ `openclaw voice enroll` command
- ✅ Voice profile database (`~/.openclaw/voice-profiles/`)
- ✅ Recognition accuracy report (target: >99%)
- ✅ Threshold tuning results

**Verification:**

```bash
# Enroll speakers
openclaw voice enroll fred
openclaw voice enroll courtney
openclaw voice enroll monty

# List profiles
openclaw voice list-profiles

# Test recognition
openclaw voice test-recognition --samples 100
```

---

### Week 4: Command Routing (Wake Word + Gateway)

**Tasks:**

1. Implement wake word detection logic
2. Add speaker validation (Fred-only commands)
3. Create gateway API endpoint `/api/voice-command`
4. Implement command routing from voice-processor to gateway
5. Test end-to-end: "oasis what time is it"
6. Add retry/queue logic for failed deliveries
7. Implement error handling and logging

**Deliverables:**

- ✅ Working voice command pipeline
- ✅ Gateway integration complete
- ✅ End-to-end latency < 9 seconds
- ✅ Error handling tests passing

**Verification:**

```bash
# Full end-to-end test
# Say: "oasis what time is it"
# Expected: OASIS responds with current time

# Check logs
docker logs voice-processor -f
docker logs oasis -f

# Verify command was routed
grep "voice-command" ~/.openclaw/logs/gateway.log
```

---

### Week 5: Curator Integration + Privacy Controls

**Tasks:**

1. Implement transcript forwarding to curator workspace
2. Create curator directory structure (`transcripts/voice/YYYY/MM/DD/`)
3. Test curator's analysis workflow with sample transcripts
4. Implement `openclaw voice pause/stop/status` commands
5. Add data retention policies (auto-delete old audio)
6. Create exclusion window support (e.g., "pause 9am-5pm")
7. Implement manual data deletion commands

**Deliverables:**

- ✅ Curator integration complete
- ✅ Privacy control CLI commands
- ✅ Data retention automation
- ✅ Status dashboard/monitoring

**Verification:**

```bash
# Verify curator receives transcripts
ls ~/.openclaw/workspace-curator/transcripts/voice/2026/02/16/

# Test privacy controls
openclaw voice pause --until 18:00
openclaw voice status
openclaw voice delete --before 2026-02-01

# Check retention policy
openclaw voice config retention
```

---

### Week 6: Testing, Tuning, Documentation

**Tasks:**

1. End-to-end integration testing (all components)
2. Stress testing (24+ hour continuous runs)
3. Performance tuning (latency, resource usage)
4. Accuracy optimization (false positive/negative rates)
5. Write user documentation
6. Create troubleshooting guide
7. Create backup/restore procedures

**Deliverables:**

- ✅ Comprehensive test report
- ✅ Performance benchmarks
- ✅ User documentation
- ✅ Deployment guide
- ✅ Troubleshooting guide

**Tests:**

```bash
# Integration tests
npm run test:integration

# Stress test (24 hours)
npm run test:stress --duration 24h

# Performance benchmarks
npm run test:performance

# Accuracy tests
npm run test:accuracy
```

---

## Privacy & Control Features

### CLI Commands

**Enrollment:**

```bash
openclaw voice enroll fred          # Record voice samples for Fred
openclaw voice enroll courtney      # Record voice samples for Courtney
openclaw voice enroll monty         # Record voice samples for Monty
openclaw voice list-profiles        # Show enrolled speakers
openclaw voice remove-profile fred  # Remove a speaker profile
```

**Control:**

```bash
openclaw voice start                # Start passive transcription
openclaw voice stop                 # Stop transcription
openclaw voice restart              # Restart transcription service
openclaw voice status               # Show recording status
```

**Privacy:**

```bash
openclaw voice pause --until <time>         # Pause until specific time
openclaw voice pause --duration 2h          # Pause for 2 hours
openclaw voice delete --before <date>       # Delete old transcripts
openclaw voice delete --range <start> <end> # Delete specific range
openclaw voice exclude --start 09:00 --end 17:00 # Exclude time window
openclaw voice exclude --days mon,wed,fri   # Exclude specific days
```

**Testing:**

```bash
openclaw voice test-recognition     # Test speaker recognition accuracy
openclaw voice test-diarization     # Test multi-speaker detection
openclaw voice test-wake-word       # Test wake word detection
openclaw voice test-e2e             # End-to-end command test
```

**Configuration:**

```bash
openclaw voice config show          # Show current configuration
openclaw voice config set retention 7d  # Set audio retention to 7 days
openclaw voice config set threshold 0.75  # Set speaker recognition threshold
```

### Data Retention Policies

**Audio Files:**

- Default: Delete after 7 days
- Configurable: 1-30 days
- Location: `~/.openclaw/voice-transcripts/raw/audio/`

**Text Transcripts:**

- Default: Keep indefinitely
- Configurable: Delete after 30/60/90 days
- Location: `~/.openclaw/workspace-curator/transcripts/voice/`

**Voice Profiles:**

- Default: Keep until manually deleted
- Location: `~/.openclaw/voice-profiles/`

**Automatic Cleanup:**

```bash
# Runs daily at 3am via cron
0 3 * * * /usr/local/bin/openclaw voice cleanup --older-than 7d
```

### Access Control

**Who can do what:**

- ✅ **Fred** - Enroll speakers, issue commands, pause/delete, configure
- ❌ **Courtney** - Transcribed but cannot issue commands
- ❌ **Monty** - Transcribed but cannot issue commands
- ❌ **Unknown speakers** - Transcribed as "unknown_speaker_N", no commands

**Security:**

- Speaker recognition threshold: 0.75 (99%+ accuracy)
- Voice profiles encrypted at rest (future enhancement)
- API keys stored in macOS Keychain
- Docker containers run as non-root user
- File permissions: 600 on voice profiles, 700 on transcripts

---

## Testing & Validation Plan

### Phase 1: Component Testing

**1. Swabble Passive Mode**

```bash
# Test continuous transcription for 1 hour
swabble serve --mode passive --config ~/.config/swabble/config.json

# Verify output
ls ~/.openclaw/voice-transcripts/raw/
jq . ~/.openclaw/voice-transcripts/raw/2026-02-16T15-30-00.json

# Test launchd restart
launchctl unload ~/Library/LaunchAgents/ai.openclaw.swabble.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.swabble.plist
launchctl list | grep swabble
```

**Expected Results:**

- ✅ JSON files written every 30 seconds
- ✅ Audio chunks saved to `.m4a` files
- ✅ Service auto-restarts after crash
- ✅ No memory leaks over 1 hour

**2. Speaker Enrollment**

```bash
# Enroll Fred
openclaw voice enroll fred
# (Record 3 samples of 10 seconds each)

# Verify profile created
cat ~/.openclaw/voice-profiles/fred.json

# Test embedding extraction
python3 services/voice-processor/python/extract_embedding.py \
  ~/.openclaw/voice-profiles/fred/sample-1.m4a
```

**Expected Results:**

- ✅ Profile JSON created with 3 embeddings
- ✅ Each embedding is 192-dimensional array
- ✅ Threshold set to 0.75
- ✅ Embedding extraction completes in <500ms

**3. Deepgram Diarization**

```bash
# Test with 2-speaker conversation
npm run test:diarization -- \
  --audio tests/fixtures/two-speakers.m4a

# Verify speaker labels
cat tests/output/diarization-result.json
```

**Expected Results:**

- ✅ Speaker labels: 0, 1 (two distinct speakers)
- ✅ Utterances grouped by speaker
- ✅ Word-level timestamps accurate
- ✅ API latency < 5 seconds

**4. Speaker Recognition**

```bash
# Test Fred vs Courtney discrimination
npm run test:recognition -- \
  --audio tests/fixtures/fred-courtney-conversation.m4a

# Generate accuracy report
npm run test:recognition -- \
  --samples 100 \
  --report recognition-accuracy.txt
```

**Expected Results:**

- ✅ Fred recognized in 99%+ of utterances
- ✅ Courtney recognized in 99%+ of utterances
- ✅ False positive rate < 1%
- ✅ Unknown speakers correctly tagged as "unknown"

---

### Phase 2: Integration Testing

**1. End-to-End Command Flow**

```bash
# Start all services
scripts/oasis-up.sh
launchctl load ~/Library/LaunchAgents/ai.openclaw.swabble.plist

# Speak into microphone
# "oasis what time is it"

# Verify command detected
docker logs voice-processor | grep "Command detected"

# Verify command routed to gateway
docker logs oasis | grep "voice-command"

# Measure latency
grep "voice-command" ~/.openclaw/logs/voice-processor.log | \
  awk '{print $NF}' | \
  stats --percentiles
```

**Expected Results:**

- ✅ Command detected within 5 seconds of speaking
- ✅ Command routed to OASIS agent
- ✅ OASIS responds with current time
- ✅ Total latency < 9 seconds (p95)

**2. Multi-Speaker Scenarios**

```bash
# Fred and Courtney conversation
# Fred: "The weather is nice today"
# Courtney: "Yes it's beautiful"
# Fred: "oasis what's the forecast for tomorrow"
# Courtney: "oasis make me a sandwich"

# Verify only Fred's command executed
docker logs oasis | grep "voice-command"
# Should see only Fred's forecast command, not Courtney's sandwich command
```

**Expected Results:**

- ✅ Both speakers transcribed correctly
- ✅ Both speakers identified (Fred, Courtney)
- ✅ Only Fred's "oasis" command executed
- ✅ Courtney's "oasis" command ignored (logged but not executed)

**3. Curator Integration**

```bash
# Generate test conversation
npm run test:curator -- --duration 5m

# Verify curator received transcripts
ls ~/.openclaw/workspace-curator/transcripts/voice/2026/02/16/

# Check file format
jq . ~/.openclaw/workspace-curator/transcripts/voice/2026/02/16/2026-02-16T15-30-00-000Z.json
```

**Expected Results:**

- ✅ Transcripts written to curator workspace
- ✅ File format correct (source, timestamp, speakers, utterances)
- ✅ All speakers included (not just Fred)
- ✅ Metadata includes device name, location

---

### Phase 3: Stress Testing

**1. Long-Running Stability (24 hours)**

```bash
# Start stress test
npm run test:stress --duration 24h

# Monitor resources
watch -n 60 'docker stats --no-stream voice-processor'
watch -n 60 'ps aux | grep swabble'

# Check for memory leaks
npm run test:memory-leak
```

**Monitoring Metrics:**

- Swabble: RAM usage should stay < 100MB
- voice-processor: RAM usage should stay < 500MB
- CPU: Average < 20% (Mac Mini 2018)
- Disk: Growth rate < 5GB/day
- Network: < 5GB/day (Deepgram API)

**Expected Results:**

- ✅ No crashes over 24 hours
- ✅ No memory leaks detected
- ✅ Error rate < 0.1%
- ✅ Processing lag < 60 seconds

**2. High Volume Conversation**

```bash
# Simulate 6 hours of continuous conversation
npm run test:high-volume -- --duration 6h --speakers 3

# Measure performance
npm run test:performance-report
```

**Expected Results:**

- ✅ No dropped transcripts
- ✅ Processing lag stays < 60 seconds
- ✅ All speakers correctly identified
- ✅ No Deepgram API rate limit errors

**3. Failure Recovery**

```bash
# Test 1: Kill voice-processor container
docker kill voice-processor
sleep 30
# Verify auto-restart
docker ps | grep voice-processor

# Test 2: Disconnect network
sudo ifconfig en0 down
sleep 30
sudo ifconfig en0 up
# Verify backlog processing

# Test 3: Deepgram API timeout
npm run test:deepgram-timeout
```

**Expected Results:**

- ✅ Container auto-restarts within 30 seconds
- ✅ Backlog processed after restart (no data loss)
- ✅ Network disconnection handled gracefully
- ✅ Deepgram timeouts trigger retry with exponential backoff

---

## Performance Expectations

### Latency Breakdown

**End-to-End Latency (Speech → Command Execution):**

1. Audio capture → transcript: **1-3 seconds**
   - Speech.framework on-device transcription
   - VAD (voice activity detection) triggers transcript

2. Transcript → diarization: **2-5 seconds**
   - File write + file watcher pickup: 200ms
   - Deepgram API call: 1.5-4.5 seconds

3. Speaker recognition: **<500ms**
   - Embedding extraction (SpeechBrain): 300ms
   - Cosine similarity matching: 50ms

4. Command detection → routing: **<200ms**
   - Wake word detection: 50ms
   - Gateway HTTP request: 100ms

**Total: 4-9 seconds (p50: 5s, p95: 8s, p99: 10s)**

### Resource Usage

**macOS Host (Swabble):**

- RAM: 50MB baseline, 100MB peak
- CPU: 5% average, 15% peak (one core)
- Disk: ~100MB/hour (audio + transcripts)
- Network: 0 (on-device transcription)

**Docker Container (voice-processor):**

- RAM: 200MB idle, 500MB peak
- CPU: 10% idle, 50% processing (one core)
- Disk: Negligible (reads transcripts, writes to curator)
- Network: ~3GB/day (Deepgram API uploads)

**Total System:**

- RAM: ~500MB
- CPU: ~15% average (Mac Mini has 6 cores)
- Disk: ~2.5GB/day (100MB/hour × 24h + margin)
- Network: ~3GB/day

### Accuracy Targets

**Transcription Accuracy:**

- Target: >95% word error rate (WER)
- Baseline: Speech.framework is ~95-98% for English
- Factors: Clear speech, low background noise, good microphone

**Speaker Diarization Accuracy:**

- Target: >85% diarization error rate (DER)
- Baseline: Deepgram DER is ~11-19% (85-89% accuracy)
- Factors: Number of speakers, speaker overlap, acoustic similarity

**Speaker Recognition Accuracy:**

- Target: >99% true positive rate, <1% false positive rate
- Method: Cosine similarity with threshold tuning
- Enrollment: 3+ samples per speaker recommended

**Wake Word Detection Accuracy:**

- Target: >98% detection rate, <1% false positive
- Method: String matching with phonetic variants
- Factors: Clear pronunciation, low background noise

### Throughput

**Conversations per Day:**

- Assumption: 6 hours of conversation per day
- 30-second chunks: 720 chunks/day
- Deepgram API calls: 720 calls/day
- Well within Deepgram rate limits (no throttling)

**Storage Growth:**

- Audio: 100MB/hour × 6 hours = 600MB/day
- Transcripts: ~50KB/hour × 6 hours = 300KB/day
- Total: ~18GB/month (with 7-day audio retention)

---

## Cost Analysis

### Monthly Operational Costs

**Deepgram API:**

- Rate: $0.0043 per minute
- Daily usage: 6 hours = 360 minutes
- Monthly: 360 min/day × 30 days = 10,800 minutes
- **Cost: $0.0043 × 10,800 = $46.44/month**

**SpeechBrain:**

- Free (open source, runs locally)
- No API costs

**Infrastructure:**

- Mac Mini: Already owned, no additional cost
- Electricity: ~$5/month (24/7 operation)
- Internet: Included in existing plan

**Total Monthly: ~$51/month**

### One-Time Costs

**Hardware:**

- Professional USB microphone (Blue Yeti): ~$100
- Alternative: Samson Q2U (~$70)
- Alternative: Audio-Technica ATR2100x (~$100)

**Software:**

- All software is free (OpenClaw, Swabble, SpeechBrain, etc.)
- No licensing fees

**Setup Time:**

- Development: 6 weeks × 20 hours/week = 120 hours
- If outsourced at $100/hour: $12,000
- Self-implementation: Free (your time)

**Total One-Time: $100 (microphone only)**

### Cost Optimization Opportunities

**Option 1: Local Diarization (pyannote.audio)**

- Replace Deepgram with local pyannote.audio model
- **Savings: $46/month → $0/month**
- Trade-offs:
  - Higher CPU usage (50% → 80%)
  - Slower processing (2-5s → 10-20s)
  - Lower accuracy (85% → 75%)
  - More complex setup

**Option 2: Reduced Transcription Hours**

- Only transcribe during work hours (9am-5pm)
- Reduces usage from 6 hours/day to ~8 hours/day
- **Savings: $46/month → $31/month** (33% reduction)

**Option 3: Lower Sampling Rate**

- Use 1-minute chunks instead of 30-second chunks
- Reduces API calls by 50%
- **Savings: $46/month → $23/month**
- Trade-off: Higher latency for command execution

**Recommendation: Keep Deepgram for MVP**

- Superior accuracy is worth $46/month
- Can migrate to local diarization in Phase 2 if cost becomes concern
- Deepgram provides better developer experience

---

## Monitoring & Alerting

### Metrics to Track

**1. Swabble Health**

- Uptime percentage (target: >99.9%)
- Transcription rate (segments/hour)
- Audio chunk write rate (chunks/minute)
- Device connection status (connected/disconnected)
- Memory usage (MB)
- CPU usage (%)

**2. voice-processor Health**

- File processing lag (seconds behind real-time)
- Deepgram API success rate (%)
- Deepgram API latency (seconds, p50/p95/p99)
- Speaker recognition match rate (%)
- Command detection rate (commands/hour)
- Memory usage (MB)
- CPU usage (%)

**3. System Performance**

- End-to-end latency (speech → command)
- Disk space remaining (GB)
- Network bandwidth usage (MB/hour)
- Error rate (errors/hour)

**4. Accuracy Metrics**

- Transcription accuracy (spot checks)
- Speaker diarization accuracy (manual validation)
- Speaker recognition false positive rate (%)
- Wake word detection accuracy (%)

### Alerting Thresholds

**Critical Alerts (Telegram notification to Fred):**

- ⚠️ Swabble service down (auto-restart failed)
- ⚠️ voice-processor service down (container crashed)
- ⚠️ Deepgram API quota exceeded (hard limit reached)
- ⚠️ Disk space < 1GB (risk of data loss)
- ⚠️ Speaker recognition failure rate > 5% (system degraded)
- ⚠️ Processing lag > 5 minutes (severe backlog)

**Warning Alerts (logged only):**

- 📝 Microphone disconnected (auto-reconnect pending)
- 📝 Processing lag > 60 seconds (minor backlog)
- 📝 Deepgram API latency > 10 seconds (slow response)
- 📝 Unknown speaker detected (not enrolled)
- 📝 Memory usage > 80% (approaching limit)
- 📝 Disk space < 5GB (cleanup recommended)

**Info Alerts (logged only):**

- ℹ️ Daily transcript summary (conversations transcribed)
- ℹ️ Weekly accuracy report (metrics summary)
- ℹ️ Monthly cost report (Deepgram usage)

### Logging

**Swabble Logs:**

```bash
# stdout (normal operation)
~/.openclaw/logs/swabble-stdout.log

# stderr (errors only)
~/.openclaw/logs/swabble-stderr.log

# View live
tail -f ~/.openclaw/logs/swabble-stdout.log
```

**voice-processor Logs:**

```bash
# Docker container logs
docker logs voice-processor -f

# Application logs (structured JSON)
~/.openclaw/logs/voice-processor.log

# View with jq
tail -f ~/.openclaw/logs/voice-processor.log | jq .
```

**Structured Log Format:**

```json
{
  "timestamp": "2026-02-16T15:30:00Z",
  "level": "info",
  "component": "diarization",
  "message": "Processed chunk",
  "metadata": {
    "chunkId": "chunk-123",
    "speakers": 2,
    "duration": 30.5,
    "latency": 2.3,
    "apiCost": 0.0022
  }
}
```

**Log Rotation:**

```yaml
# docker-compose.yml logging config
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

**Log Levels:**

- `error` - System failures, API errors, crashes
- `warn` - Degraded performance, retries, unknown speakers
- `info` - Normal operations, commands detected, processing stats
- `debug` - Detailed debugging (disabled in production)

### Dashboards

**Option 1: Prometheus + Grafana (Future Enhancement)**

- Export metrics from voice-processor
- Visualize in Grafana dashboard
- Set up alerting rules

**Option 2: Simple CLI Status (MVP)**

```bash
# Show current status
openclaw voice status
# Output:
# ✅ Swabble: Running (uptime: 3d 14h)
# ✅ voice-processor: Running (uptime: 3d 14h)
# ✅ Deepgram API: Healthy (latency: 2.3s p95)
# ℹ️ Conversations today: 4 (total: 2h 15m)
# ℹ️ Commands detected: 12
# ℹ️ Processing lag: 5 seconds
# ℹ️ Disk usage: 8.2GB / 100GB

# Show metrics
openclaw voice metrics
# Output:
# Latency (p50/p95/p99): 5.2s / 8.1s / 10.5s
# Accuracy: transcription=97%, diarization=88%, recognition=99.2%
# API usage: 320 minutes ($1.38 today, $42.15 this month)
# Errors: 3 in last 24h (0.02%)
```

---

## Security Considerations

### Threat Model

**Threat 1: Unauthorized Command Execution**

- **Attack:** Non-Fred speaker says "oasis" commands
- **Impact:** Malicious commands executed (data exfiltration, system control)
- **Mitigation:** Speaker recognition with 99%+ accuracy, high threshold
- **Fallback:** Command confirmation for sensitive operations (future)

**Threat 2: Eavesdropping on Docker Host**

- **Attack:** Compromised container reads transcript files
- **Impact:** Privacy breach, sensitive conversations exposed
- **Mitigation:**
  - File permissions: 600 on transcripts, 700 on directories
  - Docker user namespace isolation
  - Separate user for voice-processor (UID 1001)
- **Fallback:** Encrypt transcripts at rest (future enhancement)

**Threat 3: Deepgram API Key Leak**

- **Attack:** Exposed API key in logs, environment, or config files
- **Impact:** Quota abuse, financial loss, service disruption
- **Mitigation:**
  - Store in macOS Keychain (never in `.env` or config files)
  - Rotate monthly
  - Monitor usage for anomalies
- **Fallback:** Rate limiting, usage alerts

**Threat 4: Voice Spoofing / Replay Attack**

- **Attack:** Synthesized Fred voice or recorded audio to bypass recognition
- **Impact:** Unauthorized command execution
- **Mitigation:**
  - Speaker recognition has some anti-spoofing built-in
  - Detection of unnatural prosody (future)
- **Fallback:**
  - Liveness detection (future enhancement)
  - Physical device presence requirement for sensitive commands

**Threat 5: Malicious Curator Analysis**

- **Attack:** Curator agent analyzes transcripts and extracts sensitive info
- **Impact:** Privacy breach if curator compromised
- **Mitigation:**
  - Curator runs in isolated container
  - No network access except to gateway
  - Access control on workspace files
- **Fallback:** Encrypt transcripts in curator workspace (future)

### Security Hardening

**1. File Permissions**

```bash
# Transcript directories
chmod 700 ~/.openclaw/voice-transcripts
chmod 700 ~/.openclaw/voice-profiles
chmod 700 ~/.openclaw/workspace-curator/transcripts

# Profile files
chmod 600 ~/.openclaw/voice-profiles/*.json

# Config files
chmod 600 ~/.config/swabble/config.json
chmod 600 ~/.openclaw/openclaw.json
```

**2. Docker Security**

```yaml
# docker-compose.yml
voice-processor:
  user: "1001:1001" # Non-root user
  cap_drop:
    - ALL # Drop all capabilities
  security_opt:
    - no-new-privileges:true # Prevent privilege escalation
  read_only: true # Read-only root filesystem
  tmpfs:
    - /tmp # Writable tmpfs for temp files
  networks:
    - openclaw # Isolated network (no internet except gateway)
```

**3. API Key Management**

```bash
# Store in Keychain
security add-generic-password -U -s openclaw -a DEEPGRAM_API_KEY -w "your-key-here"

# Rotate monthly
security add-generic-password -U -s openclaw -a DEEPGRAM_API_KEY -w "new-key-here"
scripts/oasis-up.sh restart

# Audit usage
curl -H "Authorization: Token $DEEPGRAM_API_KEY" \
  https://api.deepgram.com/v1/projects/$PROJECT_ID/usage
```

**4. Access Control**

```typescript
// voice-processor: Only accept commands from Fred
if (speaker.name !== "fred") {
  console.warn(`Ignoring command from non-Fred speaker: ${speaker.name}`);
  return null;
}

// gateway: Validate voice command source
if (req.body.channel !== "voice" || req.body.from !== "fred") {
  return res.status(403).json({ error: "Unauthorized voice command" });
}
```

**5. Audit Logging**

```typescript
// Log all command attempts (for forensics)
auditLog.write({
  timestamp: new Date(),
  event: "command_attempt",
  speaker: speaker.name,
  command: command.command,
  wakeWord: command.wakeWord,
  allowed: speaker.name === "fred",
});
```

**6. Network Isolation**

```yaml
# docker-compose.yml
networks:
  openclaw:
    driver: bridge
    internal: true # No internet access

# Allow only gateway to have internet
openclaw-gateway:
  networks:
    - openclaw
    - default # Bridge to host network
```

---

## Future Enhancements (Post-MVP)

### Phase 2: Cost Optimization

**1. Local Speaker Diarization (pyannote.audio)**

- **Goal:** Eliminate Deepgram API cost ($46/month → $0/month)
- **Implementation:**
  - Replace Deepgram with pyannote.audio 3.0
  - Use pretrained speaker diarization model
  - Run in Python subprocess or separate container
- **Trade-offs:**
  - Higher CPU usage (50% → 80%)
  - Slower processing (2-5s → 10-20s)
  - Lower accuracy (85% → 75-80% DER)
- **Migration Path:**
  - Keep Deepgram as fallback
  - A/B test accuracy before full cutover
  - Monitor resource usage

**Code Example:**

```python
# python/diarize.py
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.0",
    use_auth_token="YOUR_HF_TOKEN"
)

diarization = pipeline("audio.wav")

for turn, _, speaker in diarization.itertracks(yield_label=True):
    print(f"{turn.start:.1f}s - {turn.end:.1f}s: {speaker}")
```

### Phase 3: Advanced Voice Features

**2. Voice Response (TTS)**

- **Goal:** OASIS speaks responses via speaker
- **Implementation:**
  - Reuse existing Telnyx TTS integration
  - Route TTS audio to macOS audio output
  - Use `afplay` or CoreAudio for playback
- **Use Cases:**
  - "oasis what time is it" → OASIS speaks "It's 3:30 PM"
  - "oasis remind me in 5 minutes" → OASIS speaks "Okay, I'll remind you in 5 minutes"
  - "oasis read my messages" → OASIS speaks Telegram message summaries

**3. Emotion Detection**

- **Goal:** Analyze vocal tone for sentiment and emotion
- **Implementation:**
  - Use emotion recognition models (e.g., Wav2Vec2 fine-tuned on emotion datasets)
  - Detect: happy, sad, angry, stressed, neutral
  - Feed to curator for emotional context
- **Use Cases:**
  - Detect stress in Fred's voice → suggest break
  - Detect frustration → curator flags for later review
  - Track emotional patterns over time

**4. Liveness Detection (Anti-Spoofing)**

- **Goal:** Detect synthesized or recorded voice
- **Implementation:**
  - Analyze acoustic features (spectral flux, cepstral coefficients)
  - Use anti-spoofing models (e.g., ASVspoof challenge winners)
  - Reject synthesized voice attempts
- **Security Benefit:**
  - Prevents voice spoofing attacks
  - Ensures only live Fred can issue commands

### Phase 4: Multi-Room & Advanced Features

**5. Multi-Room Support**

- **Goal:** Multiple microphones in different rooms
- **Implementation:**
  - Deploy Swabble on multiple Mac Minis or Raspberry Pis
  - Tag transcripts with room location
  - Privacy controls per room
- **Use Cases:**
  - Disable transcription in bedroom
  - Enable only in home office
  - Track conversations by room

**6. Conversation Summarization**

- **Goal:** Daily/weekly summaries of conversations
- **Implementation:**
  - Curator agent generates summaries
  - Extract key topics, decisions, action items
  - Send summary to Fred via Telegram
- **Use Cases:**
  - "What did I talk about today?"
  - "Did I mention calling mom this week?"
  - "What tasks came up in conversations?"

**7. Proactive Task Extraction**

- **Goal:** Automatically detect tasks from conversation
- **Implementation:**
  - NLP to identify action items
  - Curator extracts: "call mom tomorrow", "doctor appointment Tuesday"
  - Auto-add to task manager
- **Use Cases:**
  - Fred mentions "need to call mom" → task auto-created
  - Courtney says "don't forget dentist" → reminder auto-created

**8. Multi-Language Support**

- **Goal:** Support conversations in multiple languages
- **Implementation:**
  - Deepgram supports 100+ languages
  - Swabble supports 100+ locales
  - Auto-detect language per utterance
- **Use Cases:**
  - Fred speaks English and Spanish
  - Guests speak other languages
  - Transcribe and translate conversations

**9. Integration with Other Channels**

- **Goal:** Voice as first-class OpenClaw channel
- **Implementation:**
  - Voice mentions trigger Telegram messages
  - "oasis message Courtney I'm running late" → sends Telegram message
  - "oasis call Monty" → initiates phone call via Telnyx
- **Use Cases:**
  - Hands-free messaging
  - Voice-activated calls
  - Voice notes to Telegram

**10. Context-Aware Curator**

- **Goal:** Cross-reference voice with calendar, tasks, messages
- **Implementation:**
  - Curator accesses calendar API
  - Detects mentions of calendar events
  - Links conversations to events
- **Use Cases:**
  - "oasis when's my next meeting" → curator checks calendar + recent conversations
  - Fred mentions project → curator pulls related emails, tasks, conversations

---

## Critical Files Reference

### Files to Modify

1. **Swabble/Sources/swabble/Commands/ServeCommand.swift**
   - Add `--mode passive` flag
   - Implement continuous transcription without wake word gating
   - Add JSON file output logic

2. **Swabble/Sources/SwabbleCore/Speech/SpeechPipeline.swift**
   - Modify to output transcripts continuously to JSON files
   - Add audio chunk writing to `.m4a` format
   - Implement 30-second chunking

3. **src/media-understanding/providers/deepgram/audio.ts**
   - Add `diarize: true` parameter
   - Add `utterances: true` parameter
   - Parse speaker-tagged utterances from response
   - Return speaker information in result

4. **docker-compose.yml**
   - Add `voice-processor` service definition
   - Configure volume mounts for transcript sharing
   - Add secrets management for Deepgram API key
   - Set resource limits (1GB RAM, 1 CPU)

5. **scripts/oasis-up.sh**
   - Add `DEEPGRAM_API_KEY` to secrets generation from Keychain
   - Generate `voice-processor.env` file
   - Ensure proper file permissions (600)

6. **scripts/keychain-store.sh**
   - Add `DEEPGRAM_API_KEY` storage to Keychain
   - Include in initial setup workflow

7. **src/gateway/routes.ts** (or equivalent)
   - Add `/api/voice-command` endpoint
   - Validate speaker is Fred
   - Route to OASIS agent

### Files to Create

1. **services/voice-processor/** (entire new service)

   ```
   services/voice-processor/
   ├── src/
   │   ├── index.ts
   │   ├── watcher.ts
   │   ├── diarization.ts
   │   ├── speaker-recognition.ts
   │   ├── command-router.ts
   │   ├── curator-forwarder.ts
   │   ├── enrollment.ts
   │   └── types.ts
   ├── python/
   │   └── extract_embedding.py
   ├── package.json
   ├── tsconfig.json
   ├── Dockerfile
   └── README.md
   ```

2. **src/commands/voice-enroll.ts**
   - CLI command for voice enrollment
   - Record audio samples
   - Extract embeddings
   - Create voice profile JSON

3. **src/commands/voice-control.ts**
   - CLI commands: start, stop, pause, status, delete
   - Privacy controls
   - Configuration management

4. **~/Library/LaunchAgents/ai.openclaw.swabble.plist**
   - Launchd service definition for Swabble daemon
   - Auto-start on boot
   - Auto-restart on crash

5. **~/.config/swabble/config.json**
   - Configuration with passive mode settings
   - Audio device selection
   - Output directory paths

6. **~/.openclaw/voice-profiles/** (directory structure)

   ```
   ~/.openclaw/voice-profiles/
   ├── fred/
   │   ├── sample-1.m4a
   │   ├── sample-2.m4a
   │   └── sample-3.m4a
   ├── courtney/
   │   └── ...
   ├── fred.json
   └── courtney.json
   ```

7. **~/.openclaw/voice-transcripts/** (directory structure)
   ```
   ~/.openclaw/voice-transcripts/
   ├── raw/
   │   ├── 2026-02-16T15-30-00.json
   │   ├── 2026-02-16T15-30-30.json
   │   └── audio/
   │       ├── chunk-1.m4a
   │       └── chunk-2.m4a
   └── failed/  # Failed Deepgram API calls for retry
   ```

---

## Quick Start Guide

Once implementation is complete, here's how to get started:

### 1. Initial Setup

```bash
# 1. Install Deepgram API key in Keychain
security add-generic-password -U -s openclaw -a DEEPGRAM_API_KEY -w "your-key-here"

# 2. Create directory structure
mkdir -p ~/.openclaw/voice-transcripts/raw/audio
mkdir -p ~/.openclaw/voice-profiles
mkdir -p ~/.openclaw/workspace-curator/transcripts/voice
mkdir -p ~/.openclaw/logs

# 3. Build Swabble
cd ~/openclaw/Swabble
swift build -c release

# 4. Create Swabble config
mkdir -p ~/.config/swabble
cp ~/openclaw/config/swabble-config.json ~/.config/swabble/config.json

# 5. Install launchd service
cp ~/openclaw/config/ai.openclaw.swabble.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.openclaw.swabble.plist

# 6. Build voice-processor service
cd ~/openclaw/services/voice-processor
npm install
npm run build

# 7. Start Docker services
cd ~/openclaw
scripts/oasis-up.sh
```

### 2. Enroll Your Voice

```bash
# Enroll Fred (you)
openclaw voice enroll fred

# Follow prompts to record 3 samples (10 seconds each)
# Speak naturally: "This is Fred enrolling my voice profile..."

# Verify enrollment
openclaw voice list-profiles
# Output: fred (enrolled 2026-02-16T15:00:00Z)
```

### 3. Start Transcription

```bash
# Swabble should already be running via launchd
# Check status
launchctl list | grep swabble

# View logs
tail -f ~/.openclaw/logs/swabble-stdout.log

# Check voice-processor
docker logs voice-processor -f
```

### 4. Test Voice Commands

```bash
# Speak into microphone:
"oasis what time is it"

# Verify command was detected
openclaw voice status

# Check recent commands
openclaw voice history --limit 10
```

### 5. Verify Curator Integration

```bash
# Check curator received transcripts
ls ~/.openclaw/workspace-curator/transcripts/voice/2026/02/16/

# View transcript
cat ~/.openclaw/workspace-curator/transcripts/voice/2026/02/16/2026-02-16T15-30-00-000Z.json | jq .
```

---

## Troubleshooting

### Common Issues

**Issue 1: Swabble not starting**

```bash
# Check launchd logs
tail -f ~/.openclaw/logs/swabble-stderr.log

# Common causes:
# - Microphone permission not granted (System Preferences → Privacy → Microphone)
# - Speech recognition permission not granted
# - Config file syntax error

# Test manually
~/openclaw/Swabble/.build/release/swabble doctor
```

**Issue 2: voice-processor not processing transcripts**

```bash
# Check container logs
docker logs voice-processor --tail 100

# Common causes:
# - Deepgram API key not set (check Keychain)
# - Volume mount incorrect (transcripts not visible)
# - File watcher not starting

# Test volume mount
docker exec voice-processor ls /config/voice-transcripts/raw
```

**Issue 3: Commands not routing to OASIS**

```bash
# Check gateway logs
docker logs oasis | grep voice-command

# Common causes:
# - Gateway not reachable from voice-processor
# - API endpoint not implemented
# - Speaker recognition failing (not Fred)

# Test gateway connectivity
docker exec voice-processor curl http://oasis:18789/health
```

**Issue 4: Speaker recognition failing**

```bash
# Test recognition accuracy
openclaw voice test-recognition

# Common causes:
# - Threshold too high (reduce from 0.75 to 0.70)
# - Enrollment samples too few (add more samples)
# - Background noise in enrollment samples

# Re-enroll with better samples
openclaw voice remove-profile fred
openclaw voice enroll fred
```

**Issue 5: Deepgram API errors**

```bash
# Check API status
curl -H "Authorization: Token $DEEPGRAM_API_KEY" \
  https://api.deepgram.com/v1/projects/$PROJECT_ID/usage

# Common causes:
# - Quota exceeded (check usage)
# - API key invalid (rotate key)
# - Network connectivity issue

# Test API connectivity
curl -H "Authorization: Token $DEEPGRAM_API_KEY" \
  https://api.deepgram.com/v1/listen \
  -F "audio=@test.m4a"
```

---

## Summary

This implementation plan transforms OASIS into an always-on voice assistant through:

1. **Extending Swabble** for continuous passive transcription on macOS host
2. **Creating voice-processor service** for speaker diarization and recognition
3. **Using Deepgram API** for multi-speaker tracking (~$50/month)
4. **Using SpeechBrain** for voice recognition (free, local)
5. **Only accepting commands from Fred** after wake word "oasis"
6. **Logging everything to curator** for conversation analysis

**Key Benefits:**

- ✅ Always listening, no manual activation required
- ✅ Multi-speaker transcription with speaker identification
- ✅ Secure command execution (Fred-only)
- ✅ Privacy controls (pause, delete, exclude)
- ✅ Comprehensive logging for curator analysis
- ✅ Low latency (4-9 seconds speech → command)
- ✅ Cost-effective (~$50/month)

**Timeline:** 6 weeks from start to production-ready system

**Next Steps:**

1. Review this plan
2. Approve architecture and timeline
3. Begin Week 1 implementation (Swabble extensions)
4. Iterate based on testing results

---

**Questions or feedback?** Save this file and reference it throughout implementation. Update as needed based on learnings and changes.
