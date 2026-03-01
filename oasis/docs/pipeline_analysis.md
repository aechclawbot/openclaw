# OASIS Voice Pipeline Analysis

## What Are the 383 Inbox Items?

The inbox at `~/oasis-audio/inbox/` contains **383 WAV audio files**, all recorded on 2026-02-25. Each file is named `recording_YYYYMMDD_HHMMSS.wav` and represents a single speech segment captured by the always-on VAD (Voice Activity Detection) listener.

### Duration Distribution

| Duration Range | Count | % of Total |
| -------------- | ----- | ---------- |
| < 3 seconds    | 38    | 9.9%       |
| 3–5 seconds    | 103   | 26.9%      |
| 5–10 seconds   | 105   | 27.4%      |
| 10–30 seconds  | 78    | 20.4%      |
| 30–60 seconds  | 15    | 3.9%       |
| > 60 seconds   | 44    | 11.5%      |

The majority (64.2%) are under 10 seconds — short ambient sounds, brief remarks, or VAD false positives from background noise that passed the noise gate.

## Pipeline Architecture

```
[Microphone] → [audio-listener container]
                     ├── VAD (WebRTC) + Noise Gate
                     ├── Saves WAV → ~/oasis-audio/inbox/
                     ├── Submits to AssemblyAI (Universal-2 + diarization)
                     │       └── MIN_TRANSCRIBE_SECONDS = 10s (clips <10s are skipped)
                     ├── Polls for completion
                     ├── SpeechBrain ECAPA-TDNN speaker identification
                     ├── Voice command detection + dispatch
                     └── Saves enriched transcript → ~/oasis-audio/done/*.json
                                                        │
[sync-transcripts.py (launchd, polls 5s)]               │
     ├── Reads ~/oasis-audio/done/*.json  ←─────────────┘
     ├── Converts to curator format
     └── Saves → ~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/
                                                        │
[Dashboard server.js]                                    │
     └── Curator search (/api/curator/search) ──────────┘
```

## File Lifecycle

1. **Recording**: `audio-listener/app.py` VAD detects speech → records PCM frames → saves WAV to inbox
2. **Transcription**: Files ≥ 10s are submitted to AssemblyAI for transcription + diarization. Files < 10s remain in inbox but are never transcribed.
3. **Speaker ID**: After transcription, SpeechBrain ECAPA-TDNN verifies speakers against enrolled profiles (`~/.openclaw/voice-profiles/`)
4. **Voice Commands**: Transcribed text is scanned for agent trigger phrases (e.g., "hey oasis", "hey aech")
5. **Storage**: Enriched transcript JSON saved to `~/oasis-audio/done/` with `.json` extension
6. **Sync**: `sync-transcripts.py` daemon converts done transcripts to curator format, saves to `~/.openclaw/workspace-curator/transcripts/voice/YYYY/MM/DD/`
7. **Cleanup**: `AUDIO_RETENTION_DAYS` (30 days) controls automatic WAV deletion from inbox

## Current State

| Component                  | Count                  | Notes                                            |
| -------------------------- | ---------------------- | ------------------------------------------------ |
| Inbox WAVs                 | 383                    | All from 2026-02-25, none cleaned up yet         |
| Done transcripts (raw)     | 156 JSON files         | Pipeline output from AssemblyAI                  |
| Done dispatched markers    | 77 `.dispatched` files | Voice commands that were sent to agents          |
| Curator transcripts        | 134                    | Synced to dashboard format                       |
| Curator transcripts < 10s  | 63                     | Short clips with minimal content                 |
| Enrolled speakers          | 2                      | fred (5 embeddings), monty (needs re-enrollment) |
| Unknown speaker candidates | 5                      | Each with 10 embedding vectors                   |
| Orphaned embedding dirs    | 92                     | Embeddings without candidate profiles            |
| Audio sample dirs (empty)  | 6                      | SPEAKER_00–05, all with 0 audio files            |

## Key Observations

- **246 of 383 inbox WAVs (64%) are under 10 seconds** and were never transcribed by AssemblyAI (MIN_TRANSCRIBE_SECONDS=10). These are consuming disk space with no value.
- **63 curator transcripts are under 10 seconds** — these were likely synced from legacy or pre-threshold transcription runs.
- **All 6 SPEAKER\_\* audio directories are empty** — no audio clips available for manual labeling/review.
- **92 embedding directories have no matching candidate profiles** — orphaned from pipeline runs.
